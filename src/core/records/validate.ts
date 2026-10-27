import type {
  EventId,
  EventRecords,
  GauntletRecord,
  HistoryEntry,
  OpponentId,
  RaceMode,
  SaveData,
  Settings,
} from '../index.ts';
import { EVENTS } from '../events.ts';
import { LADDERS, TUNING } from '../roster.ts';
import {
  DEFAULT_SETTINGS,
  historyEntryV2,
  isInt,
  isIsoUtc,
  isObj,
  isValidBestMs,
  type HistoryEntryV2,
} from './fields.ts';
import { championId, docFields, eventRecordsV2, type SaveDataV2 } from './v2.ts';

// Save v3 document (design 34): fresh, validation with repair (34.3) and migration from v2 (34.4).

export { championId, eventUnlocked } from './v2.ts';

export const FIELD_SIZE_V3 = 6;
/** Migrated 2-runner entries (34.4). */
const FIELD_SIZE_V2 = 2;
const GAUNTLET_TIERS = 7;
const COUNT_MAX = 99999;
const LOG_MAX = 9999;

export function freshGauntlet(): GauntletRecord {
  return { runs: 0, clears: 0, furthest: 0, best: null };
}

export function freshEvent(): EventRecords {
  return {
    unlockedTier: 1,
    beaten: [],
    champion: false,
    best: {},
    history: [],
    revealed: false,
    place: {},
    gauntlet: freshGauntlet(),
  };
}

export function freshSave(
  keep: { readonly settings: Settings; readonly hints: SaveData['hints'] } = {
    settings: DEFAULT_SETTINGS,
    hints: { addToHomeScreen: false, revealSeen: false },
  },
): SaveData {
  return {
    version: 3,
    lastEvent: '100m',
    seenEvents: ['100m'],
    hints: keep.hints,
    settings: keep.settings,
    events: { '100m': freshEvent(), '110mh': freshEvent(), '400m': freshEvent() },
  };
}

/** The tier 6 rival: beating it unlocks (and, in v3, reveals) tier 7. */
export function tier6Id(event: EventId): OpponentId {
  return LADDERS[event][5]?.id ?? 'unit7';
}

/**
 * Design 34.3 history entry: the v2 rules plus place, fieldSize, winMs and mode (a mismatch drops
 * the entry), and the optional fumble logging fields (an invalid one is removed, not the entry).
 */
export function historyEntryV3(event: EventId, v: unknown, base: HistoryEntryV2 | null): HistoryEntry | null {
  if (base === null || !isObj(v)) return null;
  const fieldSize = v.fieldSize;
  if (fieldSize !== FIELD_SIZE_V3 && fieldSize !== FIELD_SIZE_V2) return null;
  const place = v.place;
  if (place !== null && !isInt(place, 1, fieldSize)) return null;
  switch (base.result) {
    case 'win':
      if (place !== 1) return null;
      break;
    case 'lose':
      if (place === null || place < 2) return null;
      break;
    default:
      if (place !== null) return null;
  }
  const winMs = v.winMs;
  if (base.result === 'dq') {
    if (winMs !== null) return null;
  } else if (!isInt(winMs, 0, EVENTS[event].dnfMs)) return null;
  if (base.result === 'win' && winMs !== base.ms) return null;
  const mode: RaceMode = v.mode === 'g' ? 'g' : 'l';

  let entry: HistoryEntry = { ...base, place, fieldSize, winMs: winMs as number | null, mode };
  const steps = v.steps;
  const fumbles = v.fumbles;
  const fumble2 = v.fumble2;
  const trips = v.trips;
  if (isInt(steps, 0, LOG_MAX)) entry = { ...entry, steps };
  const okFumbles = isInt(fumbles, 0, LOG_MAX);
  if (okFumbles) entry = { ...entry, fumbles };
  const okFumble2 = okFumbles && isInt(fumble2, 0, fumbles);
  if (okFumble2) entry = { ...entry, fumble2 };
  if (okFumble2 && isInt(trips, 0, fumble2)) entry = { ...entry, trips };
  if (v.input === 'k' || v.input === 't' || v.input === 'm') entry = { ...entry, input: v.input };
  return entry;
}

/** Design 34.3 gauntlet repair. */
export function gauntletRecord(event: EventId, v: unknown): GauntletRecord {
  if (!isObj(v)) return freshGauntlet();
  const clears = isInt(v.clears, 0, COUNT_MAX) ? v.clears : 0;
  // clears <= runs: a run count below the clears is raised to them (every clear was a run).
  const runs = Math.max(clears, isInt(v.runs, 0, COUNT_MAX) ? v.runs : 0);
  const stored = isInt(v.furthest, 0, GAUNTLET_TIERS) ? v.furthest : 0;
  const furthest = clears >= 1 ? GAUNTLET_TIERS : stored;
  return { runs, clears, furthest, best: clears >= 1 ? gauntletBest(event, v.best) : null };
}

function gauntletBest(event: EventId, v: unknown): GauntletRecord['best'] {
  if (!isObj(v) || !Array.isArray(v.times) || v.times.length !== GAUNTLET_TIERS || !isIsoUtc(v.at))
    return null;
  const times: number[] = [];
  for (const t of v.times) {
    if (typeof t !== 'number' || !isValidBestMs(event, t)) return null;
    times.push(t);
  }
  const sum = times.reduce((a, b) => a + b, 0);
  return v.ms === sum ? { ms: sum, at: v.at, times } : null;
}

/** Design 34.3 event repair on top of the v2 rules (16.3). */
function eventRecords(event: EventId, v: unknown): EventRecords {
  const base = eventRecordsV2(event, v);
  const o = isObj(v) ? v : {};
  const beaten = base.beaten;
  const revealed = o.revealed === true || base.champion || beaten.includes(championId(event));
  const place: Partial<Record<OpponentId, number>> = {};
  const rawPlace = isObj(o.place) ? o.place : {};
  for (const { id } of LADDERS[event]) {
    const p = rawPlace[id];
    if (beaten.includes(id)) place[id] = 1;
    else if (isInt(p, 2, FIELD_SIZE_V3)) place[id] = p;
  }
  const history: HistoryEntry[] = [];
  for (const h of Array.isArray(o.history) ? o.history : []) {
    const e = historyEntryV3(event, h, historyEntryV2(event, h));
    if (e !== null) history.push(e);
    if (history.length >= TUNING.HISTORY_MAX) break;
  }
  return { ...base, history, revealed, place, gauntlet: gauntletRecord(event, o.gauntlet) };
}

export type ParseResult = { ok: true; data: SaveData } | { ok: false };

/**
 * Design 34.3. Not JSON, not an object, or version !== 3: corrupt (caller backs it up and falls
 * back to v2). Otherwise every field is repaired: invalid entries dropped, invalid scalars default.
 */
export function parseSave(raw: string): ParseResult {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return { ok: false };
  }
  if (!isObj(doc) || doc.version !== 3) return { ok: false };
  const rawEvents = isObj(doc.events) ? doc.events : {};
  const events = {
    '100m': eventRecords('100m', rawEvents['100m']),
    '110mh': eventRecords('110mh', rawEvents['110mh']),
    '400m': eventRecords('400m', rawEvents['400m']),
  };
  const h = isObj(doc.hints) ? doc.hints : {};
  const hints = { addToHomeScreen: h.addToHomeScreen === true, revealSeen: h.revealSeen === true };
  return { ok: true, data: { version: 3, ...docFields(doc, events), hints, events } };
}

/** Design 34.4 migration table (v2 -> v3). */
export function migrateV2(v2: SaveDataV2): SaveData {
  const event = (id: EventId): EventRecords => {
    const e = v2.events[id];
    const revealed = e.champion || e.beaten.includes(tier6Id(id));
    const place: Partial<Record<OpponentId, number>> = {};
    for (const b of e.beaten) place[b] = 1;
    const history = e.history.map((h): HistoryEntry => {
      const common = { fieldSize: FIELD_SIZE_V2, mode: 'l' as const };
      switch (h.result) {
        case 'win':
          return { ...h, ...common, place: 1, winMs: h.ms };
        case 'lose':
          return { ...h, ...common, place: 2, winMs: h.oppMs };
        case 'dnf':
          return { ...h, ...common, place: null, winMs: h.oppMs };
        case 'dq':
          return { ...h, ...common, place: null, winMs: null };
      }
    });
    return { ...e, history, revealed, place, gauntlet: freshGauntlet() };
  };
  const events = { '100m': event('100m'), '110mh': event('110mh'), '400m': event('400m') };
  const revealSeen = Object.values(events).some((e) => e.revealed);
  // Round-trip through the v3 validator so a migrated entry that breaks a v3 rule is dropped now
  // (e.g. a v2 'lose' without oppMs), not on the next load.
  const doc: SaveData = { ...v2, version: 3, hints: { ...v2.hints, revealSeen }, events };
  const parsed = parseSave(JSON.stringify(doc));
  return parsed.ok ? parsed.data : doc;
}
