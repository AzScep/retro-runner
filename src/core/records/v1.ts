import type { BestTime, HistoryEntry, OpponentId, Settings } from '../index.ts';
import { LADDERS, TUNING } from '../roster.ts';
import { bestTime, historyEntry, isInt, isObj, ladderIds, settings } from './fields.ts';

// The v1 save (design 4.3), kept only as the migration source (design 16.4).

export interface SaveDataV1 {
  readonly version: 1;
  readonly unlockedTier: number;
  readonly beaten: readonly OpponentId[];
  readonly champion: boolean;
  readonly best: Readonly<Partial<Record<OpponentId, BestTime>>>;
  readonly history: readonly HistoryEntry[];
  readonly settings: Settings;
}

export type ParseV1Result = { ok: true; data: SaveDataV1 } | { ok: false };

/**
 * Design 4.3. Not JSON, not an object, or version !== 1: corrupt (caller backs it up).
 * A v1 document is repaired field by field: invalid entries are dropped, invalid scalars fall
 * back to defaults, and unlocks are made consistent with `beaten` and `champion`.
 */
export function parseSaveV1(raw: string): ParseV1Result {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return { ok: false };
  }
  if (!isObj(doc) || doc.version !== 1) return { ok: false };

  const ladder = LADDERS['100m'];
  const beaten = ladderIds('100m', doc.beaten);
  const champion = doc.champion === true && beaten.includes('zyx');
  const maxBeatenTier = Math.max(0, ...beaten.map((id) => ladder.findIndex((e) => e.id === id) + 1));
  const storedTier = isInt(doc.unlockedTier, 1, ladder.length) ? doc.unlockedTier : 1;
  const unlockedTier = Math.min(ladder.length, Math.max(storedTier, maxBeatenTier + 1));

  const best: Partial<Record<OpponentId, BestTime>> = {};
  if (isObj(doc.best)) {
    for (const { id } of ladder) {
      const b = bestTime('100m', doc.best[id]);
      if (b !== null) best[id] = b;
    }
  }

  const history: HistoryEntry[] = [];
  if (Array.isArray(doc.history)) {
    for (const h of doc.history) {
      const e = historyEntry('100m', h);
      if (e !== null) history.push(e);
      if (history.length >= TUNING.HISTORY_MAX) break;
    }
  }

  return {
    ok: true,
    data: { version: 1, unlockedTier, beaten, champion, best, history, settings: settings(doc.settings) },
  };
}
