import type { EventId, LadderEntry, OpponentId, OpponentInfo } from './index.ts';

// Roster, ladders and world data. Lives outside index.ts so submodules can import values without an
// import cycle through the public surface (index.ts re-exports everything here).

/** Character identity only; per-event data lives in LADDERS (design 3.2, 15.5). */
export const OPPONENTS: Readonly<Record<OpponentId, OpponentInfo>> = {
  pip: { id: 'pip', name: 'PIP', who: 'Primary school student' },
  jess: { id: 'jess', name: 'JESS', who: 'High school student' },
  marco: { id: 'marco', name: 'MARCO', who: 'University student' },
  kofi: { id: 'kofi', name: 'KOFI', who: 'Club athlete' },
  valentina: { id: 'valentina', name: 'VALENTINA', who: 'Olympian' },
  unit7: { id: 'unit7', name: 'UNIT-7', who: 'Cyborg' },
  zyx: { id: 'zyx', name: 'ZYX', who: 'Alien' },
  sol: { id: 'sol', name: 'SOL', who: 'Veteran 400 m runner' },
};

function ladder(event: EventId, rows: readonly [OpponentId, number, string][]): readonly LadderEntry[] {
  return rows.map(([id, targetMs, flavour], i) => ({ event, id, tier: i + 1, targetMs, flavour }));
}

/** Design 3.2/3.3 (100 m), 15.3 (hurdles), 15.4 (400 m); summary in 15.6. */
export const LADDERS: Readonly<Record<EventId, readonly LadderEntry[]>> = {
  '100m': ladder('100m', [
    ['pip', 18000, 'Excited, clumsy, waves to mum.'],
    ['jess', 15000, 'Fast starter. Bored by the end.'],
    ['marco', 13600, 'Talented, lazy, coasts mid-race.'],
    ['kofi', 12600, 'Disciplined. Watch his late kick.'],
    ['valentina', 11600, 'Flawless start. Composed champion.'],
    ['unit7', 11000, 'Slow to boot, then relentless.'],
    ['zyx', 10400, 'Cold, playful, bends space.'],
  ]),
  '110mh': ladder('110mh', [
    ['pip', 22000, 'Hurdles are taller than Pip.'],
    ['jess', 18600, 'Quick over the first five.'],
    ['marco', 16900, 'Lazy trail leg. Clips a few.'],
    ['kofi', 15600, 'Clean, steady, big run-in.'],
    ['valentina', 14500, 'Never touches a hurdle.'],
    ['unit7', 13800, 'Piston legs. Lossless landings.'],
    ['zyx', 13300, 'Why jump when you can warp?'],
  ]),
  '400m': ladder('400m', [
    ['pip', 72000, 'Sprints 60 m. Then not.'],
    ['jess', 64000, 'Out fast. Pays for it.'],
    ['marco', 59000, 'Coasts the back straight.'],
    ['kofi', 56000, 'Even pace. Strong last 100.'],
    ['sol', 54000, 'Even splits. Every lap.'],
    ['unit7', 52500, 'Overclocks. Overheats.'],
    ['zyx', 51400, 'Bends the bend.'],
  ]),
};

export function ladderEntry(event: EventId, id: OpponentId): LadderEntry | null {
  return LADDERS[event].find((e) => e.id === id) ?? null;
}

export function nextRival(event: EventId, id: OpponentId): OpponentId | null {
  const entry = ladderEntry(event, id);
  if (entry === null) return null;
  return LADDERS[event][entry.tier]?.id ?? null; // tier is 1-based, so index `tier` is the next one
}

export const PLAYER = { id: 'rio', name: 'RIO' } as const;

/** World constants shared by all layers (design 2.1, 2.3, 5.7). Distances per event: EVENTS. */
export const WORLD = {
  RUN_OUT_M: 20,
  PX_PER_M: 24,
  /** World px before the start line. Start line world x = START_X_PX. */
  START_X_PX: 96,
  V_MAX: 12.5,
  SIM_HZ: 120,
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
  /** Animation thresholds (design 5.6). Lean window per event: EVENT_COURSE. */
  READY_BELOW_MPS: 0.3,
  /** Per event (design 16.1). */
  HISTORY_MAX: 50,

  // Hurdles (design 13.1, 13.2, 15.2).
  HURDLE_COUNT: 10,
  HURDLE_FIRST_M: 13.72,
  HURDLE_SPACING_M: 9.14,
  HURDLE_RUN_IN_M: 14.02,
  HURDLE_HEIGHT_M: 1.0,
  JUMP_AIR_MS: 400,
  JUMP_PEAK_M: 1.3,
  JUMP_LOCK_MS: 100,
  LAND_KEEP: 0.94,
  CLIP_KEEP: 0.8,
  HIT_KEEP: 0.4,
  HIT_STUMBLE_MS: 300,
  HIT_SHAKE_PX: 2,
  HIT_SHAKE_MS: 150,
  /** Clean takeoff window, seconds before reaching the hurdle (derived from the arc, 13.2). */
  CLEAN_WINDOW_EARLY_MS: 296,
  CLEAN_WINDOW_LATE_MS: 104,
  /** Jump gauge span and "next hurdle is close" threshold for the bright up icon / JUMP pad. */
  JUMP_GAUGE_SPAN_MS: 1000,
  AI_TAKEOFF_CLEAN: 0.5,
  AI_TAKEOFF_CLIP: 0.8,
  AI_HIT_MULT: 0.3,
  AI_HIT_MS: 300,

  // 400 m stamina (design 14.1).
  SUSTAIN_RATE: 7.0,
  STEP_COST: 0.014,
  /** SUSTAIN_RATE x STEP_COST, per second. */
  REGEN: 0.098,
  S_FATIGUE: 0.3,
  V_TIRED: 6.0,
  FATIGUE_DECEL: 2.0,
  SPLIT_POPUP_MS: 2000,
  STAMINA_LOW_EVERY_MS: 600,
  STAMINA_EMPTY_EVERY_MS: 3000,
  QUARTER_FINAL_LAYER_AT_M: 300,

  // AI (design 3.1, 15.2, 15.4).
  AI_VTOP_JITTER: 0.01,
  AI_QUIRK_JITTER_M: 3,
  AI_QUIRK_JITTER_400_M: 10,
} as const;
