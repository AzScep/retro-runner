/**
 * Records screen columns (design 4.5, 18.7, 29.2), pure so tests can prove no two cells overlap.
 * Name, pip and place are left edges; time columns are centres. Hurdles add HIT after PB; the 400 m
 * has short names (Sol, no Valentina) and long times, so its columns start further left.
 */
import type { EventId } from '../core/index.ts';
import { miniTextWidth } from './miniFont.ts';

export interface RecordsColumns {
  readonly portrait: number;
  readonly name: number;
  /** 6x6 medal pip, then the place text (29.2.1). */
  readonly pip: number;
  readonly place: number;
  readonly pb: number;
  readonly hit: number | null;
  readonly target: number;
  readonly last: readonly number[];
}

export const RECORDS_COLUMNS: Readonly<Record<EventId, RecordsColumns>> = {
  '100m': {
    portrait: 8,
    name: 28,
    pip: 82,
    place: 90,
    pb: 124,
    hit: null,
    target: 166,
    last: [214, 252, 290],
  },
  '110mh': {
    portrait: 8,
    name: 28,
    pip: 82,
    place: 90,
    pb: 122,
    hit: 147,
    target: 180,
    last: [218, 255, 292],
  },
  '400m': {
    portrait: 8,
    name: 28,
    pip: 64,
    place: 72,
    pb: 110,
    hit: null,
    target: 147,
    last: [188, 232, 276],
  },
};

/** Gap in px between a LAST 3 time and its place digit (29.2.2). */
export const PLACE_GAP = 3;

/** Left edges of a LAST 3 cell's time and place digit, the pair centred on `centre`. */
export function lastCell(
  time: string,
  place: string,
  centre: number,
): { timeX: number; placeX: number; w: number } {
  const tw = miniTextWidth(time);
  const w = place === '' ? tw : tw + PLACE_GAP + miniTextWidth(place);
  const timeX = Math.round(centre - w / 2);
  return { timeX, placeX: timeX + tw + PLACE_GAP, w };
}
