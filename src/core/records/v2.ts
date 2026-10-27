import type { BestTime, EventId, OpponentId, Settings } from '../index.ts';
import { EVENT_IDS } from '../events.ts';
import { LADDERS, TUNING } from '../roster.ts';
import {
  bestTime,
  DEFAULT_SETTINGS,
  historyEntryV2,
  isInt,
  isObj,
  ladderIds,
  settings,
  type HistoryEntryV2,
} from './fields.ts';
import type { SaveDataV1 } from './v1.ts';

// The v2 save (design 16), kept only as a migration source (design 34.4): validation with repair
// (16.3) and the v1 -> v2 migration (16.4), both in memory.

export interface EventRecordsV2 {
  readonly unlockedTier: number;
  readonly beaten: readonly OpponentId[];
  readonly champion: boolean;
  readonly best: Readonly<Partial<Record<OpponentId, BestTime>>>;
  readonly history: readonly HistoryEntryV2[];
}

export interface SaveDataV2 {
  readonly version: 2;
  readonly lastEvent: EventId;
  readonly seenEvents: readonly EventId[];
  readonly hints: { readonly addToHomeScreen: boolean };
  readonly settings: Settings;
  readonly events: Readonly<Record<EventId, EventRecordsV2>>;
}

export function freshEventV2(): EventRecordsV2 {
  return { unlockedTier: 1, beaten: [], champion: false, best: {}, history: [] };
}

/** The tier 7 rival (champion flag), the same id in every event. */
export function championId(event: EventId): OpponentId {
  return LADDERS[event][LADDERS[event].length - 1]?.id ?? 'zyx';
}

/** Design 12.2, derived from the beaten sets (works for v2 and v3 events). */
export function eventUnlocked(
  events: Readonly<Record<EventId, { readonly beaten: readonly OpponentId[] }>>,
  event: EventId,
): boolean {
  switch (event) {
    case '100m':
      return true;
    case '110mh':
      return events['100m'].beaten.includes('marco');
    case '400m':
      return events['100m'].beaten.includes('kofi') || events['110mh'].beaten.includes('marco');
  }
}

/** Shared repair of the v2 event fields (design 16.3): beaten, champion, unlockedTier, best, history. */
export function eventRecordsV2(event: EventId, v: unknown): EventRecordsV2 {
  if (!isObj(v)) return freshEventV2();
  const ladder = LADDERS[event];
  const beaten = ladderIds(event, v.beaten);
  const champion = v.champion === true && beaten.includes(championId(event));
  const maxBeatenTier = Math.max(0, ...beaten.map((id) => ladder.findIndex((e) => e.id === id) + 1));
  const storedTier = isInt(v.unlockedTier, 1, ladder.length) ? v.unlockedTier : 1;
  const unlockedTier = Math.min(ladder.length, Math.max(storedTier, maxBeatenTier + 1));

  const best: Partial<Record<OpponentId, BestTime>> = {};
  if (isObj(v.best)) {
    for (const { id } of ladder) {
      const b = bestTime(event, v.best[id]);
      if (b !== null) best[id] = b;
    }
  }

  const history: HistoryEntryV2[] = [];
  if (Array.isArray(v.history)) {
    for (const h of v.history) {
      const e = historyEntryV2(event, h);
      if (e !== null) history.push(e);
      if (history.length >= TUNING.HISTORY_MAX) break;
    }
  }
  return { unlockedTier, beaten, champion, best, history };
}

/** Shared repair of the document-level fields (16.3): seenEvents, lastEvent, settings. */
export function docFields(
  doc: Record<string, unknown>,
  events: Readonly<Record<EventId, { readonly beaten: readonly OpponentId[] }>>,
): { lastEvent: EventId; seenEvents: EventId[]; settings: Settings } {
  const seen = Array.isArray(doc.seenEvents) ? doc.seenEvents : [];
  const seenEvents = EVENT_IDS.filter((e) => e === '100m' || seen.includes(e));
  const last = doc.lastEvent;
  const lastEvent =
    typeof last === 'string' &&
    (EVENT_IDS as readonly string[]).includes(last) &&
    eventUnlocked(events, last as EventId)
      ? (last as EventId)
      : '100m';
  return { lastEvent, seenEvents, settings: settings(doc.settings) };
}

export type ParseV2Result = { ok: true; data: SaveDataV2 } | { ok: false };

/**
 * Design 16.3. Not JSON, not an object, or version !== 2: corrupt. Otherwise every field is
 * repaired: invalid entries dropped, invalid scalars default.
 */
export function parseSaveV2(raw: string): ParseV2Result {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return { ok: false };
  }
  if (!isObj(doc) || doc.version !== 2) return { ok: false };
  const rawEvents = isObj(doc.events) ? doc.events : {};
  const events = {
    '100m': eventRecordsV2('100m', rawEvents['100m']),
    '110mh': eventRecordsV2('110mh', rawEvents['110mh']),
    '400m': eventRecordsV2('400m', rawEvents['400m']),
  };
  const hints = { addToHomeScreen: isObj(doc.hints) && doc.hints.addToHomeScreen === true };
  return { ok: true, data: { version: 2, ...docFields(doc, events), hints, events } };
}

/** Design 16.4 migration table (v1 -> v2, in memory only in v3). */
export function migrateV1(v1: SaveDataV1): SaveDataV2 {
  const { unlockedTier, beaten, champion, best, history } = v1;
  return {
    version: 2,
    lastEvent: '100m',
    seenEvents: ['100m'],
    hints: { addToHomeScreen: false },
    settings: { ...v1.settings, haptics: DEFAULT_SETTINGS.haptics },
    events: {
      '100m': { unlockedTier, beaten, champion, best, history },
      '110mh': freshEventV2(),
      '400m': freshEventV2(),
    },
  };
}
