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

/**
 * Named rival's kit base colour as a palette index (design 3.3, 15.5, 27.1-27.5): the HUD badge
 * frame, progress bar head and off-screen markers, and the world chevron above a rival level with
 * Rio. Chrome UNIT-7 uses metal base, which still reads apart from the field's index 7.
 */
export const RIVAL_KIT: Readonly<Record<OpponentId, number>> = {
  pip: 26,
  jess: 29,
  marco: 33,
  kofi: 26,
  valentina: 29,
  unit7: 5,
  zyx: 33,
  sol: 21,
};

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
  /** Immediate retry of the same race: runners wait at the blocks, no walk-in or meet card. */
  RETRY_INTRO_MS: 300,
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

  // [v3] Multi-runner constants (design 11 [v3], sections 23-34). Per-tier field numbers live in
  // field/specs.ts (design 25.2, 25.6).
  FIELD_RUNNERS: 4,
  /** Pace multiplier range per half (25.1). */
  FIELD_PACE_LO: 0.9,
  FIELD_PACE_HI: 1.0,
  /** Switch point as a fraction of the event distance (25.1). */
  FIELD_SWITCH_LO: 0.4,
  FIELD_SWITCH_HI: 0.8,
  /** 400 m field pace profile: [from m, multiplier] (25.1). */
  FIELD_400_PROFILE: [
    [0, 1.0],
    [200, 0.97],
    [300, 0.94],
  ],
  FIELD_SEED_XOR: 0x5bd1e995,
  /** Field floor per event (25.4): no single field finish faster than T x (1 - pct). */
  FIELD_FLOOR_PCT: { '100m': 0.02, '110mh': 0.04, '400m': 0.02 },
  /** Named-rival win share of the AI field (25.5). */
  RIVAL_WIN_SHARE_LO: 0.6,
  RIVAL_WIN_SHARE_HI: 0.75,
  /** Median winning time tolerance (25.5). */
  WIN_MEDIAN_TOL_MS: 50,
  PLAYER_LANE: 0,
  RIVAL_LANE: 1,
  /** Live position hold (27.2); applied by the UI. */
  POSITION_HOLD_MS: 350,
  /** 1st-2nd margin for the 'closeFinish' event (31.3). */
  PHOTO_MARGIN_MS: 20,
  /** The player within this of a neighbour at the line: `PHOTO!` in-race; a win this close is a PHOTO FINISH. */
  PHOTO_FINISH_MS: 50,
  /** Judges lean while any runner is within this distance of the line (31.3). */
  JUDGE_LEAN_M: 10,
  /** Meet card (31.1): first race of a tier in a session / retry. */
  MEET_CARD_SHOW_MS: 1200,
  MEET_CARD_SHOW_RETRY_MS: 800,
  /** Reveal skip allowed after (30.3; the short version skips at once). */
  REVEAL_SKIP_AFTER_MS: 1000,
  /** Gauntlet between-race card auto-advance (32.2). */
  GAUNTLET_NEXT_DELAY_MS: 3000,
  /** Deterministic trip (33): rule C, keyboard only, flag default off until the user's call (33.4). */
  TRIP_ENABLED: false as boolean,
  /** Second fumble within this time of the first (33.1). */
  TRIP_WINDOW_MS: 500,
  /** Fall: speed to 0 linearly (33.2). */
  TRIP_BLEED_MS: 250,
  /** Lie at speed 0 (33.2). */
  TRIP_LIE_MS: 400,
  /** Get-up speed as a share of the speed at the trigger (33.2). */
  TRIP_KEEP: 0.3,
  /** Visual only: state.trip stays 'getup' this long after getting up (3 frames at 12 fps, 35.1). */
  TRIP_GETUP_MS: 250,
} as const;
