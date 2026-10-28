import type { EventId, EventInfo } from './index.ts';

// Event data (design 12.1, 13.1, 14.3). Lives outside index.ts so submodules can import values
// without an import cycle through the public surface.

export const EVENT_IDS: readonly EventId[] = ['100m', '110mh', '400m'];

export const EVENTS: Readonly<Record<EventId, EventInfo>> = {
  '100m': { id: '100m', name: '100 METRES', short: '100M', distanceM: 100, dnfMs: 30000 },
  '110mh': { id: '110mh', name: '110 METRES HURDLES', short: 'HURDLES', distanceM: 110, dnfMs: 40000 },
  '400m': { id: '400m', name: '400 METRES', short: '400M', distanceM: 400, dnfMs: 90000 },
};

/** Course and presentation facts per event (design 13.4, 14.3, 18.4). */
export interface EventCourse {
  /** Lean anim window: distance - 2 m to distance + 2 m. */
  readonly leanFromM: number;
  readonly leanToM: number;
  /** Crowd intensity rises from here (last 20 m; 400 m: last 100 m). */
  readonly crowdFromM: number;
  /** Distance boards every N m (100 m and hurdles: 10, 400 m: 50). */
  readonly boardStepM: number;
  /** Player split marks (400 m only). */
  readonly splitsM: readonly number[];
  /** Lap bell mark (400 m only), else null. */
  readonly bellAtM: number | null;
  /** Pre-race tip for the first race ever in this event, per modality (design 13.4.4, 14.3.9). */
  readonly firstRaceTip: { readonly keyboard: string; readonly touch: string } | null;
}

export const EVENT_COURSE: Readonly<Record<EventId, EventCourse>> = {
  '100m': {
    leanFromM: 98,
    leanToM: 102,
    crowdFromM: 80,
    boardStepM: 10,
    splitsM: [],
    bellAtM: null,
    // The core skill of every event: the expected key alternates (R1).
    firstRaceTip: { keyboard: 'ALTERNATE LEFT + RIGHT', touch: 'TAP LEFT, RIGHT, LEFT...' },
  },
  '110mh': {
    leanFromM: 108,
    leanToM: 112,
    crowdFromM: 90,
    boardStepM: 10,
    splitsM: [],
    bellAtM: null,
    firstRaceTip: { keyboard: 'UP TO JUMP', touch: 'TAP JUMP' },
  },
  '400m': {
    leanFromM: 398,
    leanToM: 402,
    crowdFromM: 300,
    boardStepM: 50,
    splitsM: [100, 200, 300],
    bellAtM: 300,
    firstRaceTip: {
      keyboard: 'WATCH STAMINA. STEADY BEATS FAST.',
      touch: 'WATCH STAMINA. STEADY BEATS FAST.',
    },
  },
};

/** Design 13.1: H1 at 13.72 m, then every 9.14 m (exact two-decimal metres). */
const HURDLES_110: readonly number[] = Array.from(
  { length: 10 },
  (_, i) => Math.round((13.72 + 9.14 * i) * 100) / 100,
);

export function hurdlePositions(event: EventId): readonly number[] {
  return event === '110mh' ? HURDLES_110 : [];
}

/**
 * Design 12.2: unlock card text for a locked event. Only 1st place is a win (24.1), and the rival may
 * still be a `???` silhouette, so the text names the tier, which every ladder card shows.
 */
export const EVENT_LOCK_TEXT: Readonly<Record<EventId, readonly string[]>> = {
  '100m': [],
  '110mh': ['WIN TIER 3 IN 100M'],
  '400m': ['WIN TIER 4 IN 100M', 'OR TIER 3 IN HURDLES'],
};
