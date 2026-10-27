import type {
  HistoryEntry,
  KeyValueStorage,
  OpponentId,
  RaceOutcome,
  RecordOutcome,
  SaveData,
  Settings,
} from '../index.ts';
import { OPPONENT_IDS, OPPONENTS, TUNING } from '../roster.ts';
import { DEFAULT_SETTINGS, freshSave, isValidBestMs, parseSave } from './validate.ts';

export const SAVE_KEY = 'retroRunner.save.v1';
export const CORRUPT_KEY = 'retroRunner.save.corrupt';

/**
 * Owns the save document (design 4.2-4.3, unlocks 1.3). Never throws on storage failure: it keeps
 * working in memory and reports `persistent === false` from then on.
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

  static load(storage: KeyValueStorage | null): RecordsStore {
    if (storage === null) return new RecordsStore(null, freshSave());
    let raw: string | null;
    try {
      raw = storage.getItem(SAVE_KEY);
    } catch {
      const store = new RecordsStore(storage, freshSave());
      store.ok = false;
      return store;
    }
    if (raw === null) return new RecordsStore(storage, freshSave());
    const parsed = parseSave(raw);
    if (parsed.ok) return new RecordsStore(storage, parsed.data);
    // Corrupt: back up the raw string, start fresh and persist the fresh save.
    const store = new RecordsStore(storage, freshSave());
    store.write(CORRUPT_KEY, raw);
    store.save();
    return store;
  }

  get data(): SaveData {
    return this.doc;
  }

  get persistent(): boolean {
    return this.ok;
  }

  isUnlocked(id: OpponentId): boolean {
    return OPPONENTS[id].tier <= this.doc.unlockedTier;
  }

  isBeaten(id: OpponentId): boolean {
    return this.doc.beaten.includes(id);
  }

  bestMs(id: OpponentId): number | null {
    return this.doc.best[id]?.ms ?? null;
  }

  recent(id: OpponentId, n: number): readonly HistoryEntry[] {
    return this.doc.history.filter((h) => h.opp === id).slice(0, Math.max(0, n));
  }

  ladderTotalMs(): number | null {
    let total = 0;
    for (const id of OPPONENT_IDS) {
      const ms = this.bestMs(id);
      if (ms === null) return null;
      total += ms;
    }
    return total;
  }

  record(outcome: RaceOutcome, at: Date): RecordOutcome {
    const id = outcome.opponent;
    const iso = at.toISOString();
    const timed = outcome.result === 'win' || outcome.result === 'lose';
    const entry: HistoryEntry = {
      opp: id,
      result: outcome.result,
      ms: timed ? outcome.ms : null,
      oppMs: outcome.result === 'dq' ? null : outcome.oppMs,
      falseStarts: outcome.falseStarts,
      seed: outcome.seed >>> 0,
      at: iso,
    };
    const history = [entry, ...this.doc.history].slice(0, TUNING.HISTORY_MAX);

    const previousPbMs = this.bestMs(id);
    const ms = timed ? outcome.ms : null;
    const newPb = ms !== null && isValidBestMs(ms) && (previousPbMs === null || ms < previousPbMs);
    const best = newPb ? { ...this.doc.best, [id]: { ms, at: iso } } : this.doc.best;

    let { unlockedTier, beaten, champion } = this.doc;
    let unlocked: OpponentId | null = null;
    let becameChampion = false;
    if (outcome.result === 'win') {
      if (!beaten.includes(id)) beaten = OPPONENT_IDS.filter((o) => o === id || beaten.includes(o));
      const tier = OPPONENTS[id].tier;
      const next = OPPONENT_IDS[tier]; // tier is 1-based, so index `tier` is the next rival
      if (next !== undefined && unlockedTier < tier + 1) {
        unlockedTier = tier + 1;
        unlocked = next;
      }
      if (id === 'zyx' && !champion) {
        champion = true;
        becameChampion = true;
      }
    }

    this.doc = { ...this.doc, unlockedTier, beaten, champion, best, history };
    this.save();
    return { newPb, previousPbMs, unlocked, becameChampion };
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
   * Options -> reset records: removes the save key and starts fresh. Settings are kept (volume and
   * mute are not "records") and written back so they survive a reload.
   */
  reset(): void {
    const settings = this.doc.settings;
    this.doc = freshSave(settings);
    if (this.storage !== null) {
      try {
        this.storage.removeItem(SAVE_KEY);
      } catch {
        this.ok = false;
      }
    }
    this.save();
  }

  private save(): void {
    this.write(SAVE_KEY, JSON.stringify(this.doc));
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
