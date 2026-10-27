import type { BestTime, EventId, HistoryEntry, OpponentId, RaceResult, Settings } from '../index.ts';
import { EVENTS, hurdlePositions } from '../events.ts';
import { LADDERS, TUNING } from '../roster.ts';

// Field validators shared by the v1 and v2 parsers (migration sources) and the v3 validator
// (design 4.3, 16.3, 34.3).

/** A history entry as stored by v1 and v2 (no v3 fields). */
export type HistoryEntryV2 = Omit<
  HistoryEntry,
  'place' | 'fieldSize' | 'winMs' | 'mode' | 'steps' | 'fumbles' | 'fumble2' | 'trips' | 'input'
>;

export const DEFAULT_SETTINGS: Settings = {
  volume: 8,
  muted: false,
  reducedFlashing: false,
  screenShake: true,
  crt: false,
  haptics: true,
};

/** PB_RANGE_MS per event (design 16.3). */
export const PB_RANGE_MS: Readonly<Record<EventId, readonly [number, number]>> = {
  '100m': [5000, 30000],
  '110mh': [8000, 40000],
  '400m': [40000, 90000],
};

const RESULTS: readonly RaceResult[] = ['win', 'lose', 'dq', 'dnf'];
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;
const OPP_MS_MAX = 600000;
const SPLITS_MAX = 3;

export type Obj = Record<string, unknown>;

export function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function isInt(v: unknown, lo: number, hi: number): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
}

export function isIsoUtc(v: unknown): v is string {
  return typeof v === 'string' && ISO_UTC.test(v) && !Number.isNaN(Date.parse(v));
}

export function isValidBestMs(event: EventId, ms: number): boolean {
  const [lo, hi] = PB_RANGE_MS[event];
  return isInt(ms, lo, hi);
}

function onLadder(event: EventId, v: unknown): v is OpponentId {
  return typeof v === 'string' && LADDERS[event].some((e) => e.id === v);
}

/** Rival ids of the event's ladder found in `v`, unique, in ladder order. */
export function ladderIds(event: EventId, v: unknown): OpponentId[] {
  if (!Array.isArray(v)) return [];
  return LADDERS[event].map((e) => e.id).filter((id) => v.includes(id));
}

/** Hurdles hit count, 0 to the number of hurdles. */
function isHit(v: unknown): v is number {
  return isInt(v, 0, hurdlePositions('110mh').length);
}

/** 0-3 strictly increasing integers in 0-90000, each below `belowMs` when given. */
export function isSplits(v: unknown, belowMs: number | null): v is number[] {
  if (!Array.isArray(v) || v.length > SPLITS_MAX) return false;
  const cap = EVENTS['400m'].dnfMs;
  let prev = -1;
  for (const s of v) {
    if (!isInt(s, 0, cap) || s <= prev || (belowMs !== null && s >= belowMs)) return false;
    prev = s;
  }
  return true;
}

/**
 * PB entry. Extras are optional (migrated and older PBs have none): hurdles `hit` 0-10, 400 m
 * `splits` (exactly 3 values). An invalid extra is dropped, not the PB.
 */
export function bestTime(event: EventId, v: unknown): BestTime | null {
  if (!isObj(v) || typeof v.ms !== 'number' || !isValidBestMs(event, v.ms) || !isIsoUtc(v.at)) return null;
  const b: BestTime = { ms: v.ms, at: v.at };
  if (event === '110mh' && isHit(v.hit)) return { ...b, hit: v.hit };
  if (event === '400m' && isSplits(v.splits, v.ms) && v.splits.length === SPLITS_MAX) {
    return { ...b, splits: [...v.splits] };
  }
  return b;
}

/**
 * History entry, v2 fields (design 4.3 common fields, 16.3 extras). Hurdles entries require `hit`,
 * 400 m entries require `splits` (DQ: empty); other events never carry them.
 */
export function historyEntryV2(event: EventId, v: unknown): HistoryEntryV2 | null {
  if (!isObj(v) || !onLadder(event, v.opp)) return null;
  const result = v.result;
  if (typeof result !== 'string' || !(RESULTS as readonly string[]).includes(result)) return null;
  const r = result as RaceResult;
  const timed = r === 'win' || r === 'lose';
  const ms = v.ms;
  const oppMs = v.oppMs;
  if (timed ? !isInt(ms, 0, EVENTS[event].dnfMs) : ms !== null) return null;
  if (r === 'dq' ? oppMs !== null : !(oppMs === null || isInt(oppMs, 0, OPP_MS_MAX))) return null;
  if (!isInt(v.falseStarts, 0, TUNING.FALSE_STARTS_TO_DQ)) return null;
  if (!isInt(v.seed, 0, 0xffffffff) || !isIsoUtc(v.at)) return null;
  const entry: HistoryEntryV2 = {
    opp: v.opp,
    result: r,
    ms: timed ? (ms as number) : null,
    oppMs: (oppMs as number | null) ?? null,
    falseStarts: v.falseStarts,
    seed: v.seed,
    at: v.at,
  };
  if (event === '110mh') return isHit(v.hit) ? { ...entry, hit: v.hit } : null;
  if (event === '400m') {
    const splits = v.splits;
    if (!isSplits(splits, timed ? (ms as number) : null)) return null;
    if (r === 'dq' && splits.length > 0) return null;
    return { ...entry, splits: [...splits] };
  }
  return entry;
}

export function settings(v: unknown): Settings {
  const s = isObj(v) ? v : {};
  const bool = (x: unknown, d: boolean): boolean => (typeof x === 'boolean' ? x : d);
  return {
    volume: isInt(s.volume, 0, 10) ? s.volume : DEFAULT_SETTINGS.volume,
    muted: bool(s.muted, DEFAULT_SETTINGS.muted),
    reducedFlashing: bool(s.reducedFlashing, DEFAULT_SETTINGS.reducedFlashing),
    screenShake: bool(s.screenShake, DEFAULT_SETTINGS.screenShake),
    crt: bool(s.crt, DEFAULT_SETTINGS.crt),
    haptics: bool(s.haptics, DEFAULT_SETTINGS.haptics),
  };
}
