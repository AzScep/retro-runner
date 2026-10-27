import type { OpponentId, OpponentInfo } from './index.ts';

// Roster and world data. Lives outside index.ts so submodules can import values without an
// import cycle through the public surface (index.ts re-exports everything here).

export const OPPONENT_IDS: readonly OpponentId[] = [
  'pip',
  'jess',
  'marco',
  'kofi',
  'valentina',
  'unit7',
  'zyx',
];

export const OPPONENTS: Readonly<Record<OpponentId, OpponentInfo>> = {
  pip: {
    id: 'pip',
    tier: 1,
    name: 'PIP',
    who: 'Primary school student',
    targetMs: 18000,
    flavour: 'Excited, clumsy, waves to mum.',
  },
  jess: {
    id: 'jess',
    tier: 2,
    name: 'JESS',
    who: 'High school student',
    targetMs: 15000,
    flavour: 'Fast starter. Bored by the end.',
  },
  marco: {
    id: 'marco',
    tier: 3,
    name: 'MARCO',
    who: 'University student',
    targetMs: 13600,
    flavour: 'Talented, lazy, coasts mid-race.',
  },
  kofi: {
    id: 'kofi',
    tier: 4,
    name: 'KOFI',
    who: 'Club athlete',
    targetMs: 12600,
    flavour: 'Disciplined. Watch his late kick.',
  },
  valentina: {
    id: 'valentina',
    tier: 5,
    name: 'VALENTINA',
    who: 'Olympian',
    targetMs: 11600,
    flavour: 'Flawless start. Composed champion.',
  },
  unit7: {
    id: 'unit7',
    tier: 6,
    name: 'UNIT-7',
    who: 'Cyborg',
    targetMs: 11000,
    flavour: 'Slow to boot, then relentless.',
  },
  zyx: {
    id: 'zyx',
    tier: 7,
    name: 'ZYX',
    who: 'Alien',
    targetMs: 10400,
    flavour: 'Cold, playful, bends space.',
  },
};

export const PLAYER = { id: 'rio', name: 'RIO' } as const;

/** World constants shared by all layers (design 2.1, 2.3, 5.7). */
export const WORLD = {
  RACE_DISTANCE_M: 100,
  RUN_OUT_M: 20,
  PX_PER_M: 24,
  /** World px before the start line. Start line world x = START_X_PX. */
  START_X_PX: 96,
  V_MAX: 12.5,
  SIM_HZ: 120,
  DNF_MS: 30000,
} as const;

/** Every other tunable from design section 11 (times in ms, speeds in m/s). */
export const TUNING = {
  STEP_IMPULSE: 0.5,
  K_DRAG: 0.5,
  IDLE_GRACE_MS: 250,
  IDLE_DECEL: 3.0,
  MIN_STEP_INTERVAL_MS: 35,
  INTRO_MS: 1500,
  COUNT_STEP_MS: 800,
  COUNT_ONE_JITTER_MS: 500,
  GO_TEXT_MS: 600,
  FALSE_START_BANNER_MS: 1500,
  FALSE_STARTS_TO_DQ: 2,
  RESULTS_DELAY_MS: 1500,
  /** Frozen "GET SET" beat after resume (design 8.4). */
  RESUME_FREEZE_MS: 500,
  /** Animation thresholds (design 5.6). */
  LEAN_FROM_M: 98,
  LEAN_TO_M: 102,
  READY_BELOW_MPS: 0.3,
  HISTORY_MAX: 50,
} as const;
