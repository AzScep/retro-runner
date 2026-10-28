import type {
  BestTime,
  EventId,
  EventRecords,
  GauntletEnd,
  GauntletOutcome,
  GauntletRecord,
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
import { DEFAULT_SETTINGS, isInt, isValidBestMs } from './fields.ts';
import { parseSaveV1 } from './v1.ts';
import { migrateV1, parseSaveV2, type SaveDataV2 } from './v2.ts';
import { championId, eventUnlocked, freshSave, migrateV2, parseSave, tier6Id } from './validate.ts';

export const SAVE_KEY_V1 = 'retroRunner.save.v1';
export const SAVE_KEY_V2 = 'retroRunner.save.v2';
export const SAVE_KEY = 'retroRunner.save.v3';
export const CORRUPT_KEY = 'retroRunner.save.corrupt';

const GAUNTLET_TIERS = 7;
/** Tier hidden until the reveal (design 30). */
const HIDDEN_TIER = 7;

/**
 * Owns the v3 save document (design 34; unlocks 1.3 per event, event unlocks 12.2, reveal 30,
 * Gauntlet 32.5). Never throws on storage failure: it keeps working in memory and reports
 * `persistent === false` from then on. The v2 and v1 keys are only ever read (migration) and
 * removed (reset), never written.
 */
export class RecordsStore {
  private doc: SaveData;
  private storage: KeyValueStorage | null;
  private ok: boolean;
  /** One corrupt backup per load: the newest corrupt document wins (an older one never overwrites it). */
  private backedUp = false;

  private constructor(storage: KeyValueStorage | null, doc: SaveData) {
    this.storage = storage;
    this.ok = storage !== null;
    this.doc = doc;
  }

  /** Design 34.4 load order. `settings` seeds a fresh save only; a stored save keeps its own. */
  static load(storage: KeyValueStorage | null, settings: Settings = DEFAULT_SETTINGS): RecordsStore {
    const fresh = (): SaveData => freshSave({ settings, hints: freshSave().hints });
    if (storage === null) return new RecordsStore(null, fresh());
    const store = new RecordsStore(storage, fresh());
    const raw = store.read(SAVE_KEY);
    if (raw === undefined) return store; // reads throw: in-memory only
    if (raw !== null) {
      const parsed = parseSave(raw);
      if (parsed.ok) {
        store.doc = parsed.data;
        return store;
      }
      // Rule 2: back up the corrupt v3, then fall back to v2.
      store.backup(raw);
    }
    const v2 = store.loadV2();
    if (v2 !== undefined) {
      // Rules 3-4: migrate and write v3 at once; a failed write keeps it in memory (34.4.3).
      if (v2 !== null) {
        store.doc = migrateV2(v2);
        store.save();
      } else if (store.backedUp) {
        // Nothing usable: persist the fresh v3 only when a corrupt document was replaced.
        store.save();
      }
    }
    return store;
  }

  /**
   * v2 key, else v1 via v2 (16.4, in memory). null: nothing usable (a corrupt one is backed up);
   * undefined: a read threw (in-memory only).
   */
  private loadV2(): SaveDataV2 | null | undefined {
    const rawV2 = this.read(SAVE_KEY_V2);
    if (rawV2 === undefined) return undefined;
    if (rawV2 !== null) {
      const v2 = parseSaveV2(rawV2);
      if (v2.ok) return v2.data;
      this.backup(rawV2);
    }
    const rawV1 = this.read(SAVE_KEY_V1);
    if (rawV1 === undefined) return undefined;
    if (rawV1 === null) return null;
    const v1 = parseSaveV1(rawV1);
    if (v1.ok) return migrateV1(v1.data);
    this.backup(rawV1);
    return null;
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

  /** [v3] Tier 7 stays locked (and hidden) until the reveal in that event. */
  isUnlocked(event: EventId, id: OpponentId): boolean {
    const entry = ladderEntry(event, id);
    if (entry === null || !this.isEventUnlocked(event)) return false;
    if (entry.tier >= HIDDEN_TIER && !this.isRevealed(event)) return false;
    return entry.tier <= this.doc.events[event].unlockedTier;
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

  /** [v3] Best place 1-6 against this rival, or null (no 6-runner placing yet and never beaten). */
  bestPlace(event: EventId, id: OpponentId): number | null {
    return this.doc.events[event].place[id] ?? null;
  }

  isRevealed(event: EventId): boolean {
    return this.doc.events[event].revealed;
  }

  /** Design 30.1.5: tier 6 beaten and the reveal not finished (or never started). */
  revealPending(event: EventId): boolean {
    const ev = this.doc.events[event];
    return !ev.revealed && ev.beaten.includes(tier6Id(event));
  }

  /** Design 30.1.4: the reveal reached its final card or was skipped. */
  markRevealed(event: EventId): void {
    const ev = this.doc.events[event];
    if (ev.revealed && this.doc.hints.revealSeen) return;
    this.doc = {
      ...this.doc,
      hints: { ...this.doc.hints, revealSeen: true },
      events: { ...this.doc.events, [event]: { ...ev, revealed: true } },
    };
    this.save();
  }

  /** hints.revealSeen: false = the next reveal is the full version, true = the short one. */
  revealSeen(): boolean {
    return this.doc.hints.revealSeen;
  }

  /** Design 23.2.7: Gauntlet opens once Zyx is revealed in that event. */
  isGauntletUnlocked(event: EventId): boolean {
    return this.isEventUnlocked(event) && this.isRevealed(event);
  }

  gauntlet(event: EventId): GauntletRecord {
    return this.doc.events[event].gauntlet;
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
    const place = timed ? outcome.place : null;

    let entry: HistoryEntry = {
      opp: id,
      result: outcome.result,
      ms,
      oppMs: outcome.result === 'dq' ? null : outcome.oppMs,
      falseStarts: outcome.falseStarts,
      seed: outcome.seed >>> 0,
      at: iso,
      place,
      fieldSize: outcome.fieldSize,
      winMs: outcome.result === 'dq' ? null : outcome.result === 'win' ? ms : outcome.winMs,
      mode: outcome.mode,
      ...logging(outcome),
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

    // Best placing (34.1): from 6-runner races only; a better place replaces it.
    const prevPlace = ev.place[id];
    const improved = place !== null && (prevPlace === undefined || place < prevPlace);
    const places = improved ? { ...ev.place, [id]: place } : ev.place;
    const newBestPlace = improved && place >= 2 && place <= 3 ? place : null;

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
    const records: EventRecords = { ...ev, unlockedTier, beaten, champion, best, history, place: places };
    this.doc = { ...this.doc, events: { ...this.doc.events, [event]: records } };
    const unlockedEvent = EVENT_IDS.find((e) => !before.includes(e) && this.isEventUnlocked(e)) ?? null;
    this.save();
    const revealPending = outcome.result === 'win' && id === tier6Id(event) && !records.revealed;
    return {
      newPb,
      previousPbMs,
      unlocked,
      unlockedEvent,
      becameChampion,
      place,
      newBestPlace,
      revealPending,
    };
  }

  /** Design 32.5: a Gauntlet run ended (over, clear or abandoned). */
  recordGauntletEnd(event: EventId, end: GauntletEnd, at: Date): GauntletOutcome {
    const g = this.gauntlet(event);
    const reached = end.cleared ? GAUNTLET_TIERS : isInt(end.furthest, 0, GAUNTLET_TIERS) ? end.furthest : 0;
    const times = end.times;
    const validClear =
      end.cleared && times.length === GAUNTLET_TIERS && times.every((t) => isValidBestMs(event, t));
    const total = validClear ? times.reduce((a, b) => a + b, 0) : null;
    const previousBestMs = g.best?.ms ?? null;
    const newBest = total !== null && (previousBestMs === null || total < previousBestMs);
    const newFurthest = reached > g.furthest;
    const next: GauntletRecord = {
      runs: Math.min(99999, g.runs + 1),
      clears: Math.min(99999, g.clears + (end.cleared ? 1 : 0)),
      furthest: Math.max(g.furthest, reached),
      best: newBest && total !== null ? { ms: total, at: at.toISOString(), times: [...times] } : g.best,
    };
    const ev = this.doc.events[event];
    this.doc = { ...this.doc, events: { ...this.doc.events, [event]: { ...ev, gauntlet: next } } };
    this.save();
    return { newBest, newFurthest, previousBestMs };
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
   * Options -> reset records (design 34.4 rule 4): removes the v3, v2 and v1 keys and starts a
   * fresh v3 that keeps settings and hint flags (revealSeen stays, so the next reveal is short),
   * written back so they survive a reload.
   */
  reset(): void {
    this.doc = freshSave({ settings: this.doc.settings, hints: this.doc.hints });
    for (const key of [SAVE_KEY, SAVE_KEY_V2, SAVE_KEY_V1]) {
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

  private backup(raw: string): void {
    if (this.backedUp) return;
    this.backedUp = true;
    this.write(CORRUPT_KEY, raw);
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

/** Fumble logging fields (33.5), clamped to the stored ranges (34.3). */
function logging(o: RaceOutcome): Pick<HistoryEntry, 'steps' | 'fumbles' | 'fumble2' | 'trips' | 'input'> {
  const cap = (n: number): number => Math.min(9999, Math.max(0, Math.round(n)));
  const fumbles = cap(o.fumbles);
  const fumble2 = Math.min(fumbles, cap(o.fumble2));
  return { steps: cap(o.steps), fumbles, fumble2, trips: Math.min(fumble2, cap(o.trips)), input: o.input };
}
