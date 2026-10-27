import type {
  BestTime,
  EventId,
  EventRecords,
  HistoryEntry,
  OpponentId,
  SaveData,
  Settings,
} from '../index.ts';
import { EVENT_IDS } from '../events.ts';
import { LADDERS, TUNING } from '../roster.ts';
import { bestTime, DEFAULT_SETTINGS, historyEntry, isInt, isObj, ladderIds, settings } from './fields.ts';
import type { SaveDataV1 } from './v1.ts';

// Save v2 document: fresh, validation with repair (design 16.3), migration from v1 (16.4) and the
// derived event unlocks (12.2).

export function freshEvent(): EventRecords {
  return { unlockedTier: 1, beaten: [], champion: false, best: {}, history: [] };
}

export function freshSave(
  keep: { readonly settings: Settings; readonly hints: SaveData['hints'] } = {
    settings: DEFAULT_SETTINGS,
    hints: { addToHomeScreen: false },
  },
): SaveData {
  return {
    version: 2,
    lastEvent: '100m',
    seenEvents: ['100m'],
    hints: keep.hints,
    settings: keep.settings,
    events: { '100m': freshEvent(), '110mh': freshEvent(), '400m': freshEvent() },
  };
}

/** Tier of the event's tier 7 rival (champion flag), the same id in every event. */
export function championId(event: EventId): OpponentId {
  return LADDERS[event][LADDERS[event].length - 1]?.id ?? 'zyx';
}

/**
 * Design 12.2, derived on every read from the beaten sets, never stored:
 * hurdles after a 100 m win vs Marco; 400 m after a 100 m win vs Kofi or a hurdles win vs Marco.
 */
export function eventUnlocked(events: SaveData['events'], event: EventId): boolean {
  switch (event) {
    case '100m':
      return true;
    case '110mh':
      return events['100m'].beaten.includes('marco');
    case '400m':
      return events['100m'].beaten.includes('kofi') || events['110mh'].beaten.includes('marco');
  }
}

function eventRecords(event: EventId, v: unknown): EventRecords {
  if (!isObj(v)) return freshEvent();
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

  const history: HistoryEntry[] = [];
  if (Array.isArray(v.history)) {
    for (const h of v.history) {
      const e = historyEntry(event, h);
      if (e !== null) history.push(e);
      if (history.length >= TUNING.HISTORY_MAX) break;
    }
  }
  return { unlockedTier, beaten, champion, best, history };
}

export type ParseResult = { ok: true; data: SaveData } | { ok: false };

/**
 * Design 16.3. Not JSON, not an object, or version !== 2: corrupt (caller backs it up and falls
 * back to v1). Otherwise every field is repaired: invalid entries dropped, invalid scalars default.
 */
export function parseSave(raw: string): ParseResult {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return { ok: false };
  }
  if (!isObj(doc) || doc.version !== 2) return { ok: false };

  const rawEvents = isObj(doc.events) ? doc.events : {};
  const events = {
    '100m': eventRecords('100m', rawEvents['100m']),
    '110mh': eventRecords('110mh', rawEvents['110mh']),
    '400m': eventRecords('400m', rawEvents['400m']),
  };
  const seen = Array.isArray(doc.seenEvents) ? doc.seenEvents : [];
  const seenEvents = EVENT_IDS.filter((e) => e === '100m' || seen.includes(e));
  const last = doc.lastEvent;
  const lastEvent =
    typeof last === 'string' &&
    (EVENT_IDS as readonly string[]).includes(last) &&
    eventUnlocked(events, last as EventId)
      ? (last as EventId)
      : '100m';
  const hints = { addToHomeScreen: isObj(doc.hints) && doc.hints.addToHomeScreen === true };
  return {
    ok: true,
    data: { version: 2, lastEvent, seenEvents, hints, settings: settings(doc.settings), events },
  };
}

/** Design 16.4 migration table. */
export function migrateV1(v1: SaveDataV1): SaveData {
  const fresh = freshSave({ settings: { ...v1.settings, haptics: true }, hints: { addToHomeScreen: false } });
  const { unlockedTier, beaten, champion, best, history } = v1;
  return { ...fresh, events: { ...fresh.events, '100m': { unlockedTier, beaten, champion, best, history } } };
}
