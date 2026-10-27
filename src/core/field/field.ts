import type { EventId, FieldBodyId, FieldRunnerInfo, FieldVariant, MeetInfo } from '../index.ts';
import { EVENTS, hurdlePositions } from '../events.ts';
import type { RivalPlan } from '../opponents/ai.ts';
import type { HurdleAction, MarkSpec, RivalSpec, ZoneSpec } from '../opponents/specs.ts';
import { uniform } from '../rng/mulberry32.ts';
import { TUNING } from '../roster.ts';

// The race field (design 24.2-24.4, 25, 31.1): cohorts, names, meets, field AI numbers and the
// seeded per-race field plan. Field runners reuse RivalSim with a synthetic spec (25.1).

/** Runners per race: player, named rival and 4 field runners (24.1). */
export const FIELD_SIZE = 6;

const VARIANTS: readonly FieldVariant[] = ['A', 'B', 'C', 'D'];

interface TierRow {
  readonly body: FieldBodyId;
  readonly names: readonly [string, string, string, string];
  readonly meet: string;
  /** Design 25.2. */
  readonly reactionMs: number;
  readonly tau: number;
  readonly pClip: number;
  readonly pHit: number;
}

const TIERS: readonly TierRow[] = [
  {
    body: 'fKid',
    names: ['DOT', 'MILO', 'BEA', 'NOOR'],
    meet: 'SPORTS DAY',
    reactionMs: 300,
    tau: 1.5,
    pClip: 0.3,
    pHit: 0.03,
  },
  {
    body: 'fTeen',
    names: ['KAI', 'RUBY', 'TEO', 'ZARA'],
    meet: 'SCHOOL CHAMPS',
    reactionMs: 250,
    tau: 1.2,
    pClip: 0.2,
    pHit: 0,
  },
  {
    body: 'fStudent',
    names: ['FINN', 'ANYA', 'RAJ', 'LENA'],
    meet: 'CAMPUS GAMES',
    reactionMs: 220,
    tau: 1.6,
    pClip: 0.2,
    pHit: 0,
  },
  {
    body: 'fClub',
    names: ['BRUNO', 'IMANI', 'SVEN', 'MEI'],
    meet: 'CITY OPEN',
    reactionMs: 180,
    tau: 1.4,
    pClip: 0.12,
    pHit: 0,
  },
  {
    body: 'fElite',
    names: ['ODA', 'PAZ', 'NIKO', 'ADA'],
    meet: 'WORLD GAMES',
    reactionMs: 150,
    tau: 1.3,
    pClip: 0.05,
    pHit: 0,
  },
  {
    body: 'fBot',
    names: ['MK-2', 'MK-3', 'MK-4', 'MK-5'],
    meet: 'NEON CUP',
    reactionMs: 120,
    tau: 1.6,
    pClip: 0.05,
    pHit: 0,
  },
  {
    body: 'fDrone',
    names: ['ZX-1', 'ZX-2', 'ZX-3', 'ZX-4'],
    meet: 'GALACTIC MEET',
    reactionMs: 80,
    tau: 1.1,
    pClip: 0.05,
    pHit: 0,
  },
];

/**
 * V_FIELD per event and tier (design 25.6 starting values, retuned headlessly by
 * field/tuning.test.ts so the median winning time of the 5 AI is the tier target).
 */
export const V_FIELD: Readonly<Record<EventId, readonly number[]>> = {
  '100m': [6.268, 7.491, 8.615, 9.209, 9.994, 10.924, 11.008],
  '110mh': [6.038, 6.964, 8.158, 8.702, 9.322, 10.365, 10],
  '400m': [5.923, 6.651, 7.269, 7.64, 7.913, 8.181, 8.282],
};

/** FIELD_PACE_LO per event and tier (design 25.4: raised in steps of 0.01 if the floor fails). */
export const FIELD_PACE_LO: Readonly<Record<EventId, readonly number[]>> = {
  '100m': [0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9],
  '110mh': [0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9],
  '400m': [0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.9],
};

function tierRow(tier: number): TierRow {
  const row = TIERS[tier - 1];
  if (row === undefined || !Number.isInteger(tier)) throw new Error(`no field for tier ${tier}`);
  return row;
}

const INFO: readonly (readonly FieldRunnerInfo[])[] = TIERS.map((row, i) =>
  VARIANTS.map((variant, v) => ({ tier: i + 1, body: row.body, variant, name: row.names[v] ?? '' })),
);

export function fieldRunners(tier: number): readonly FieldRunnerInfo[] {
  tierRow(tier);
  return INFO[tier - 1] ?? [];
}

export function meet(tier: number): MeetInfo {
  return { tier, name: tierRow(tier).meet };
}

/** One field runner's seeded race (design 25.1, 25.3). */
export interface FieldEntry {
  readonly lane: number;
  readonly info: FieldRunnerInfo;
  readonly m1: number;
  readonly m2: number;
  /** Switch point in metres. */
  readonly switchM: number;
  readonly hurdles: readonly HurdleAction[];
}

/**
 * Design 25.3 draw order from `rng` (= mulberry32(seed ^ FIELD_SEED_XOR)): 3 draws for the
 * Fisher-Yates lane shuffle of the 4 variants, then per runner in lane order 2-5: m1, m2, switch
 * fraction, then one draw per hurdle (110 m hurdles only).
 */
export function planField(event: EventId, tier: number, rng: () => number): readonly FieldEntry[] {
  const row = tierRow(tier);
  const runners = [...fieldRunners(tier)];
  for (let i = runners.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = runners[i] as FieldRunnerInfo;
    runners[i] = runners[j] as FieldRunnerInfo;
    runners[j] = a;
  }
  const lo = FIELD_PACE_LO[event][tier - 1] ?? TUNING.FIELD_PACE_LO;
  const hi = TUNING.FIELD_PACE_HI;
  const distanceM = distance(event);
  const hurdleCount = hurdlePositions(event).length;
  return runners.map((info, i): FieldEntry => {
    const m1 = uniform(rng, lo, hi);
    const m2 = uniform(rng, lo, hi);
    const switchM = distanceM * uniform(rng, TUNING.FIELD_SWITCH_LO, TUNING.FIELD_SWITCH_HI);
    const hurdles = Array.from({ length: hurdleCount }, (): HurdleAction => {
      const d = rng();
      return d < row.pHit ? 'hit' : d < row.pHit + row.pClip ? 'clip' : 'clean';
    });
    return { lane: 2 + i, info, m1, m2, switchM, hurdles };
  });
}

function distance(event: EventId): number {
  return EVENTS[event].distanceM;
}

/**
 * A field runner as a RivalSim spec and plan: no quirks, no jitter, no pressure; zones give m1
 * before the switch point and m2 after it, times the 400 m profile (zones multiply).
 */
export function fieldSpecAndPlan(
  event: EventId,
  tier: number,
  entry: FieldEntry,
  vField = V_FIELD[event][tier - 1] ?? 0,
): { spec: RivalSpec; plan: RivalPlan } {
  const row = tierRow(tier);
  const marks: MarkSpec[] = [{ at: entry.switchM, jitter: false, fire: { kind: 'none' } }];
  const zones: ZoneSpec[] = [
    { to: 0, mult: entry.m1 },
    { from: 0, mult: entry.m2 },
  ];
  if (event === '400m') {
    // Profile steps after the start (x1.00 from 0 m is implicit); each zone ends at the next step.
    const steps = TUNING.FIELD_400_PROFILE.filter(([fromM]) => fromM > 0);
    const first = marks.length;
    for (const [fromM] of steps) marks.push({ at: fromM, jitter: false, fire: { kind: 'none' } });
    steps.forEach(([, mult], k) => {
      const z: ZoneSpec = { from: first + k, mult };
      zones.push(k + 1 < steps.length ? { ...z, to: first + k + 1 } : z);
    });
  }
  const spec: RivalSpec = {
    reactionMs: row.reactionMs,
    tau: row.tau,
    vTop: vField,
    marks,
    zones,
    ...(event === '110mh' ? { hurdles: { pClip: row.pClip, landKeep: TUNING.LAND_KEEP, script: {} } } : {}),
  };
  return { spec, plan: { vTop: vField, at: marks.map((m) => m.at), hurdles: entry.hurdles } };
}
