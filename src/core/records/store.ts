import type {
  BestTime,
  EventId,
  EventRecords,
  HistoryEntry,
  KeyValueStorage,
  OpponentId,
  RaceOutcome,
  RecordOutcome,
  SaveData,
  Settings,
} from '../index.ts';
import { EVENT_IDS } from '../events.ts';
import { LADDERS, ladderEntry, nextRival, TUNING } from '../roster.ts';
import { DEFAULT_SETTINGS, isValidBestMs } from './fields.ts';
import { parseSaveV1 } from './v1.ts';
import { championId, eventUnlocked, freshSave, migrateV1, parseSave } from './validate.ts';

export const SAVE_KEY_V1 = 'retroRunner.save.v1';
export const SAVE_KEY = 'retroRunner.save.v2';
export const CORRUPT_KEY = 'retroRunner.save.corrupt';

/**
 * Owns the v2 save document (design 16; unlocks 1.3 per event, event unlocks 12.2). Never throws on
 * storage failure: it keeps working in memory and reports `persistent === false` from then on.
 * The v1 key is only ever read (migration) and removed (reset), never written.
 */
export class RecordsStore {
  private doc: SaveData;
  private storage: KeyValueStorage | null;
  private ok: boolean;

  private constructor(storage: KeyValueStorage | null, doc: SaveData) {
    this.storage = storage;
    this.ok = storage !== null;
    this.doc = doc;
  }

  /** Design 16.4 load order. */
  static load(storage: KeyValueStorage | null): RecordsStore {
    if (storage === null) return new RecordsStore(null, freshSave());
    const store = new RecordsStore(storage, freshSave());
    const raw = store.read(SAVE_KEY);
    if (raw === undefined) return store; // reads throw: in-memory only
    if (raw !== null) {
      const parsed = parseSave(raw);
      if (parsed.ok) {
        store.doc = parsed.data;
        return store;
      }
      // Rule 2: back up the corrupt v2, then fall back to v1.
      store.write(CORRUPT_KEY, raw);
    }
    const rawV1 = store.read(SAVE_KEY_V1);
    if (rawV1 === undefined) return store;
    if (rawV1 !== null) {
      const v1 = parseSaveV1(rawV1);
      if (v1.ok) {
        // Rule 3: migrate and write v2 at once; a failed write keeps it in memory (rule 4).
        store.doc = migrateV1(v1.data);
        store.save();
        return store;
      }
      // Rule 4 of the load order: corrupt v1 is backed up (v1 rule) and a fresh v2 starts.
      store.write(CORRUPT_KEY, rawV1);
      store.save();
      return store;
    }
    // Nothing usable: fresh. Persist it only when a corrupt v2 was replaced.
    if (raw !== null) store.save();
    return store;
  }

  get data(): SaveData {
    return this.doc;
  }

  get persistent(): boolean {
    return this.ok;
  }

  isEventUnlocked(event: EventId): boolean {
    return eventUnlocked(this.doc.events, event);
  }

  isUnlocked(event: EventId, id: OpponentId): boolean {
    const entry = ladderEntry(event, id);
    return entry !== null && this.isEventUnlocked(event) && entry.tier <= this.doc.events[event].unlockedTier;
  }

  isBeaten(event: EventId, id: OpponentId): boolean {
    return this.doc.events[event].beaten.includes(id);
  }

  best(event: EventId, id: OpponentId): BestTime | null {
    return this.doc.events[event].best[id] ?? null;
  }

  bestMs(event: EventId, id: OpponentId): number | null {
    return this.best(event, id)?.ms ?? null;
  }

  recent(event: EventId, id: OpponentId, n: number): readonly HistoryEntry[] {
    return this.doc.events[event].history.filter((h) => h.opp === id).slice(0, Math.max(0, n));
  }

  /** Sum of the event's 7 PBs, or null until all 7 exist (design 16.5). */
  ladderTotalMs(event: EventId): number | null {
    let total = 0;
    for (const { id } of LADDERS[event]) {
      const ms = this.bestMs(event, id);
      if (ms === null) return null;
      total += ms;
    }
    return total;
  }

  record(outcome: RaceOutcome, at: Date): RecordOutcome {
    const event = outcome.event;
    const id = outcome.opponent;
    const entryInfo = ladderEntry(event, id);
    if (entryInfo === null) throw new Error(`${id} is not on the ${event} ladder`);
    const ev = this.doc.events[event];
    const iso = at.toISOString();
    const timed = outcome.result === 'win' || outcome.result === 'lose';
    const ms = timed ? outcome.ms : null;
    const splits = outcome.result === 'dq' ? [] : [...outcome.splits];

    let entry: HistoryEntry = {
      opp: id,
      result: outcome.result,
      ms,
      oppMs: outcome.result === 'dq' ? null : outcome.oppMs,
      falseStarts: outcome.falseStarts,
      seed: outcome.seed >>> 0,
      at: iso,
    };
    if (event === '110mh') entry = { ...entry, hit: outcome.hit ?? 0 };
    if (event === '400m') entry = { ...entry, splits };
    const history = [entry, ...ev.history].slice(0, TUNING.HISTORY_MAX);

    const previousPbMs = this.bestMs(event, id);
    const newPb = ms !== null && isValidBestMs(event, ms) && (previousPbMs === null || ms < previousPbMs);
    let best = ev.best;
    if (newPb) {
      let pb: BestTime = { ms, at: iso };
      if (event === '110mh') pb = { ...pb, hit: outcome.hit ?? 0 };
      if (event === '400m' && splits.length === 3) pb = { ...pb, splits };
      best = { ...ev.best, [id]: pb };
    }

    let { unlockedTier, beaten, champion } = ev;
    let unlocked: OpponentId | null = null;
    let becameChampion = false;
    if (outcome.result === 'win') {
      if (!beaten.includes(id))
        beaten = LADDERS[event].map((e) => e.id).filter((o) => o === id || beaten.includes(o));
      const next = nextRival(event, id);
      if (next !== null && unlockedTier < entryInfo.tier + 1) {
        unlockedTier = entryInfo.tier + 1;
        unlocked = next;
      }
      if (id === championId(event) && !champion) {
        champion = true;
        becameChampion = true;
      }
    }

    const before = EVENT_IDS.filter((e) => this.isEventUnlocked(e));
    const records: EventRecords = { unlockedTier, beaten, champion, best, history };
    this.doc = { ...this.doc, events: { ...this.doc.events, [event]: records } };
    const unlockedEvent = EVENT_IDS.find((e) => !before.includes(e) && this.isEventUnlocked(e)) ?? null;
    this.save();
    return { newPb, previousPbMs, unlocked, unlockedEvent, becameChampion };
  }

  /** The player opened this event's ladder: clears its NEW! badge and remembers it as lastEvent. */
  markEventSeen(event: EventId): void {
    if (!this.isEventUnlocked(event)) return;
    const seenEvents = this.doc.seenEvents.includes(event)
      ? this.doc.seenEvents
      : EVENT_IDS.filter((e) => e === event || this.doc.seenEvents.includes(e));
    if (seenEvents === this.doc.seenEvents && this.doc.lastEvent === event) return;
    this.doc = { ...this.doc, seenEvents, lastEvent: event };
    this.save();
  }

  setHint(name: 'addToHomeScreen', value: boolean): void {
    if (this.doc.hints[name] === value) return;
    this.doc = { ...this.doc, hints: { ...this.doc.hints, [name]: value } };
    this.save();
  }

  updateSettings(patch: Partial<Settings>): void {
    const merged = { ...this.doc.settings };
    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
      const value = patch[key];
      if (value === undefined) continue;
      if (key === 'volume') {
        if (typeof value === 'number' && Number.isFinite(value)) {
          merged.volume = Math.min(10, Math.max(0, Math.round(value)));
        }
      } else if (typeof value === 'boolean') {
        merged[key] = value;
      }
    }
    this.doc = { ...this.doc, settings: merged };
    this.save();
  }

  /**
   * Options -> reset records (design 16.4 rule 5): removes the v2 and v1 keys and starts a fresh v2
   * that keeps settings and hint flags, written back so they survive a reload.
   */
  reset(): void {
    this.doc = freshSave({ settings: this.doc.settings, hints: this.doc.hints });
    for (const key of [SAVE_KEY, SAVE_KEY_V1]) {
      if (this.storage === null) break;
      try {
        this.storage.removeItem(key);
      } catch {
        this.ok = false;
      }
    }
    this.save();
  }

  private save(): void {
    this.write(SAVE_KEY, JSON.stringify(this.doc));
  }

  /** Raw value, null if absent, undefined if reading throws (then the store is in-memory only). */
  private read(key: string): string | null | undefined {
    if (this.storage === null) return null;
    try {
      return this.storage.getItem(key);
    } catch {
      this.ok = false;
      return undefined;
    }
  }

  private write(key: string, value: string): void {
    if (this.storage === null) return;
    try {
      this.storage.setItem(key, value);
    } catch {
      this.ok = false;
    }
  }
}
