import type { BestTime, HistoryEntry, OpponentId, RaceResult, SaveData, Settings } from '../index.ts';
import { OPPONENT_IDS, OPPONENTS, TUNING, WORLD } from '../roster.ts';

export const DEFAULT_SETTINGS: Settings = {
  volume: 8,
  muted: false,
  reducedFlashing: false,
  screenShake: true,
  crt: false,
};

export function freshSave(settings: Settings = DEFAULT_SETTINGS): SaveData {
  return {
    version: 1,
    unlockedTier: 1,
    beaten: [],
    champion: false,
    best: {},
    history: [],
    settings,
  };
}

export const BEST_MIN_MS = 5000;
export const BEST_MAX_MS = WORLD.DNF_MS;
const RESULTS: readonly RaceResult[] = ['win', 'lose', 'dq', 'dnf'];
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isOpponentId(v: unknown): v is OpponentId {
  return typeof v === 'string' && (OPPONENT_IDS as readonly string[]).includes(v);
}

function isInt(v: unknown, lo: number, hi: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
}

export function isIsoUtc(v: unknown): v is string {
  return typeof v === 'string' && ISO_UTC.test(v) && !Number.isNaN(Date.parse(v));
}

export function isValidBestMs(ms: number): boolean {
  return isInt(ms, BEST_MIN_MS, BEST_MAX_MS);
}

function bestTime(v: unknown): BestTime | null {
  if (!isObj(v) || !isInt(v.ms, BEST_MIN_MS, BEST_MAX_MS) || !isIsoUtc(v.at)) return null;
  return { ms: v.ms, at: v.at };
}

function historyEntry(v: unknown): HistoryEntry | null {
  if (!isObj(v) || !isOpponentId(v.opp)) return null;
  const result = v.result;
  if (typeof result !== 'string' || !(RESULTS as readonly string[]).includes(result)) return null;
  const r = result as RaceResult;
  const timed = r === 'win' || r === 'lose';
  const ms = v.ms;
  const oppMs = v.oppMs;
  if (timed ? !isInt(ms, 0, WORLD.DNF_MS) : ms !== null) return null;
  if (r === 'dq' ? oppMs !== null : !(oppMs === null || isInt(oppMs, 0, 600000))) return null;
  if (!isInt(v.falseStarts, 0, TUNING.FALSE_STARTS_TO_DQ)) return null;
  if (!isInt(v.seed, 0, 0xffffffff) || !isIsoUtc(v.at)) return null;
  return {
    opp: v.opp,
    result: r,
    ms: timed ? (ms as number) : null,
    oppMs: (oppMs as number | null) ?? null,
    falseStarts: v.falseStarts,
    seed: v.seed,
    at: v.at,
  };
}

function settings(v: unknown): Settings {
  const s = isObj(v) ? v : {};
  const bool = (x: unknown, d: boolean): boolean => (typeof x === 'boolean' ? x : d);
  return {
    volume: isInt(s.volume, 0, 10) ? s.volume : DEFAULT_SETTINGS.volume,
    muted: bool(s.muted, DEFAULT_SETTINGS.muted),
    reducedFlashing: bool(s.reducedFlashing, DEFAULT_SETTINGS.reducedFlashing),
    screenShake: bool(s.screenShake, DEFAULT_SETTINGS.screenShake),
    crt: bool(s.crt, DEFAULT_SETTINGS.crt),
  };
}

export type ParseResult = { ok: true; data: SaveData } | { ok: false };

/**
 * Design 4.3. Not JSON, not an object, or version !== 1: corrupt (caller backs it up).
 * A v1 document is repaired field by field: invalid entries are dropped, invalid scalars fall
 * back to defaults, and unlocks are made consistent with `beaten` and `champion`.
 */
export function parseSave(raw: string): ParseResult {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return { ok: false };
  }
  if (!isObj(doc) || doc.version !== 1) return { ok: false };

  const beaten = Array.isArray(doc.beaten)
    ? OPPONENT_IDS.filter((id) => (doc.beaten as unknown[]).includes(id))
    : [];
  const champion = doc.champion === true && beaten.includes('zyx');
  const maxBeatenTier = Math.max(0, ...beaten.map((id) => OPPONENTS[id].tier));
  const storedTier = isInt(doc.unlockedTier, 1, OPPONENT_IDS.length) ? doc.unlockedTier : 1;
  const unlockedTier = Math.min(OPPONENT_IDS.length, Math.max(storedTier, maxBeatenTier + 1));

  const best: Partial<Record<OpponentId, BestTime>> = {};
  if (isObj(doc.best)) {
    for (const id of OPPONENT_IDS) {
      const b = bestTime(doc.best[id]);
      if (b !== null) best[id] = b;
    }
  }

  const history: HistoryEntry[] = [];
  if (Array.isArray(doc.history)) {
    for (const h of doc.history) {
      const e = historyEntry(h);
      if (e !== null) history.push(e);
      if (history.length >= TUNING.HISTORY_MAX) break;
    }
  }

  return {
    ok: true,
    data: { version: 1, unlockedTier, beaten, champion, best, history, settings: settings(doc.settings) },
  };
}
