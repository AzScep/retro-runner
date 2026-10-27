import type { EventId, OpponentId, QuirkName, RunnerEffect } from '../index.ts';
import { hurdlePositions } from '../events.ts';

// Per-event rival data (design 3.2-3.3 for the 100 m, 15.2-15.4 for hurdles and 400 m).

/** What happens when a rival first reaches a mark. */
export type Fire =
  | { readonly kind: 'none' }
  | { readonly kind: 'announce'; readonly names: readonly QuirkName[] }
  /** A multiplier (and optional overlay effect / stumble anim) for a fixed time. */
  | {
      readonly kind: 'timed';
      readonly ms: number;
      readonly mult: number;
      readonly names: readonly QuirkName[];
      readonly effect?: RunnerEffect;
      readonly stumble?: boolean;
    }
  /** Vanish for 0.25 s without moving, then reappear `jumpM` further on at the same speed. */
  | { readonly kind: 'warp'; readonly jumpM: number };

export interface MarkSpec {
  /** Base distance in m. */
  readonly at: number;
  /** Distance-based marks shift by the event's AI_QUIRK_JITTER per race; hurdle-anchored ones never do. */
  readonly jitter: boolean;
  readonly fire: Fire;
}

/** A distance range with a multiplier on V_TOP (pace segments and distance quirks). */
export interface ZoneSpec {
  /** Mark index the zone starts at; omitted = from the start line. */
  readonly from?: number;
  /** Mark index the zone ends at (exclusive) ... */
  readonly to?: number;
  /** ... or a length in m from its start; neither = to the line. */
  readonly len?: number;
  readonly mult: number;
  /** Overlay shown while inside the zone (before the finish). */
  readonly effect?: RunnerEffect;
}

export type HurdleAction = 'clean' | 'clip' | 'hit' | 'warp';

export interface HurdleSpec {
  readonly pClip: number;
  readonly landKeep: number;
  /** Scripted outcome per hurdle index (0-based); overrides the pClip draw. */
  readonly script: Readonly<Partial<Record<number, HurdleAction>>>;
}

export interface RivalSpec {
  readonly reactionMs: number;
  /** Speed approach time constant in s. */
  readonly tau: number;
  /** Cruise speed in m/s, tuned headlessly (see vtop.test.ts). */
  readonly vTop: number;
  readonly marks: readonly MarkSpec[];
  readonly zones: readonly ZoneSpec[];
  /** Zyx: from mark `from` on, a player leading by more than `leadM` gives x1.03 until he no longer leads. */
  readonly pressure?: { readonly from: number; readonly leadM: number };
  /** Hurdles only. */
  readonly hurdles?: HurdleSpec;
}

const H = hurdlePositions('110mh');
const h = (n: number): number => H[n - 1] ?? 0;

const NONE: Fire = { kind: 'none' };
const jit = (at: number, fire: Fire = NONE): MarkSpec => ({ at, jitter: true, fire });
const fixed = (at: number, fire: Fire = NONE): MarkSpec => ({ at, jitter: false, fire });
const say = (...names: QuirkName[]): Fire => ({ kind: 'announce', names });
const TRIP: Fire = { kind: 'timed', ms: 600, mult: 0.3, names: ['trip'], stumble: true };
const WAVE: Fire = { kind: 'timed', ms: 1000, mult: 0.85, names: ['wave'], effect: 'wave' };
const WATCH: Fire = { kind: 'timed', ms: 500, mult: 1, names: ['watch'], effect: 'watch' };
const warp = (jumpM: number): Fire => ({ kind: 'warp', jumpM });
/** Hurdles warp-through: vanish at h - 2.5 m, reappear at h + 2.5 m (15.2). */
const WARP_THROUGH_HALF_M = 2.5;

const hurdles = (pClip: number, script: HurdleSpec['script'] = {}, landKeep = 0.94): HurdleSpec => ({
  pClip,
  landKeep,
  script,
});

/**
 * V_TOP values are tuned by a headless sweep of 1000 seeded races per rival and event
 * (opponents/vtop.test.ts) so the mean finish matches the target within +/-0.05 s, pressure excluded.
 * Measured means are in the comments. Design starting values, for reference:
 * 100 m 6.55, 7.70, 8.77, 8.99, 9.63, 11.74, 10.18; hurdles 6.66, 7.22, 8.75, 8.66, 8.95, 10.40, 8.99;
 * 400 m 6.56, 6.52, 7.13, 7.37, 7.65, 8.00, 7.79.
 */
export const RIVAL_SPECS: Readonly<Record<EventId, Readonly<Partial<Record<OpponentId, RivalSpec>>>>> = {
  '100m': {
    // Tuned 2026-10-27 (v1), unchanged in v2.
    pip: {
      reactionMs: 300,
      tau: 1.5,
      vTop: 6.383, // 17999.6 ms
      marks: [jit(45, TRIP), jit(80, WAVE)],
      zones: [],
    },
    jess: {
      reactionMs: 250,
      tau: 1.2,
      vTop: 7.628, // 15000.7 ms
      marks: [jit(60, say('fade'))],
      zones: [{ from: 0, mult: 0.9 }],
    },
    marco: {
      reactionMs: 220,
      tau: 1.8,
      vTop: 8.757, // 13600.0 ms
      marks: [jit(30, say('coast'))],
      zones: [{ from: 0, len: 20, mult: 0.93 }],
    },
    kofi: {
      reactionMs: 180,
      tau: 1.4,
      vTop: 9.025, // 12599.5 ms
      marks: [jit(80, say('kick'))],
      zones: [{ from: 0, mult: 1.05 }],
    },
    valentina: {
      reactionMs: 140,
      tau: 1.2,
      vTop: 9.666, // 11599.5 ms
      marks: [jit(70, say('kick', 'flashbulb'))],
      zones: [{ from: 0, mult: 1.04 }],
    },
    unit7: {
      reactionMs: 100,
      tau: 2.4,
      vTop: 11.604, // 11000.1 ms
      marks: [jit(50, say('overclock')), jit(85, say('overheat'))],
      zones: [
        { from: 0, to: 1, mult: 1.06, effect: 'overclock' },
        { from: 1, len: 7, mult: 0.8, effect: 'overheat' },
      ],
    },
    zyx: {
      reactionMs: 50,
      tau: 1.0,
      vTop: 10.158, // 10400.0 ms
      marks: [jit(30, warp(5)), jit(65, warp(5)), jit(50)],
      zones: [],
      pressure: { from: 2, leadM: 1.5 },
    },
  },
  '110mh': {
    // Tuned 2026-10-27.
    pip: {
      reactionMs: 300,
      tau: 1.5,
      vTop: 6.674, // 22000.9 ms
      marks: [jit(100, WAVE)],
      zones: [],
      hurdles: hurdles(0.3, { 2: 'hit', 6: 'hit' }),
    },
    jess: {
      reactionMs: 250,
      tau: 1.2,
      vTop: 7.19, // 18601.0 ms
      marks: [fixed(h(6), say('fade'))],
      zones: [{ from: 0, mult: 0.9 }],
      hurdles: hurdles(0.15),
    },
    marco: {
      reactionMs: 220,
      tau: 1.8,
      vTop: 8.699, // 16900.7 ms
      marks: [fixed(h(3), say('coast')), fixed(h(5))],
      zones: [{ from: 0, to: 1, mult: 0.93 }],
      hurdles: hurdles(0.25),
    },
    kofi: {
      reactionMs: 180,
      tau: 1.4,
      vTop: 8.632, // 15600.6 ms
      marks: [fixed(96, say('kick'))],
      zones: [{ from: 0, mult: 1.08 }],
      hurdles: hurdles(0.1),
    },
    valentina: {
      reactionMs: 140,
      tau: 1.2,
      vTop: 8.944, // 14500.1 ms
      marks: [fixed(h(8), say('kick')), fixed(h(10), say('flashbulb'))],
      zones: [{ from: 0, mult: 1.03 }],
      hurdles: hurdles(0),
    },
    unit7: {
      reactionMs: 100,
      tau: 2.4,
      vTop: 10.396, // 13800.0 ms
      marks: [jit(50, say('overclock')), jit(85, say('overheat'))],
      zones: [
        { from: 0, to: 1, mult: 1.06, effect: 'overclock' },
        { from: 1, len: 7, mult: 0.8, effect: 'overheat' },
      ],
      hurdles: hurdles(0, { 8: 'clip' }, 1.0),
    },
    zyx: {
      reactionMs: 50,
      tau: 1.0,
      vTop: 8.968, // 13299.6 ms
      marks: [
        fixed(h(4) - WARP_THROUGH_HALF_M, warp(2 * WARP_THROUGH_HALF_M)),
        fixed(h(8) - WARP_THROUGH_HALF_M, warp(2 * WARP_THROUGH_HALF_M)),
        jit(55),
      ],
      zones: [],
      pressure: { from: 2, leadM: 1.5 },
      hurdles: hurdles(0, { 3: 'warp', 7: 'warp' }),
    },
  },
  '400m': {
    // Tuned 2026-10-27.
    pip: {
      reactionMs: 300,
      tau: 1.5,
      vTop: 6.572, // 72000.6 ms
      marks: [jit(60, say('sweat')), jit(380, WAVE)],
      zones: [
        { to: 0, mult: 1.4 },
        { from: 0, mult: 0.8, effect: 'sweat' },
      ],
    },
    jess: {
      reactionMs: 250,
      tau: 1.2,
      vTop: 6.522, // 63998.8 ms
      marks: [jit(150), jit(250, say('fade'))],
      zones: [
        { to: 0, mult: 1.12 },
        { from: 1, mult: 0.85 },
      ],
    },
    marco: {
      reactionMs: 220,
      tau: 1.8,
      vTop: 7.128, // 59001.8 ms
      marks: [jit(150, say('coast')), jit(250), jit(320, say('kick'))],
      zones: [
        { from: 0, to: 1, mult: 0.92 },
        { from: 1, to: 2, mult: 0.98 },
        { from: 2, mult: 1.06 },
      ],
    },
    kofi: {
      reactionMs: 180,
      tau: 1.4,
      vTop: 7.367, // 56001.0 ms
      marks: [jit(200), jit(320, say('kick'))],
      zones: [
        { from: 0, to: 1, mult: 0.97 },
        { from: 1, mult: 1.04 },
      ],
    },
    sol: {
      reactionMs: 150,
      tau: 1.6,
      vTop: 7.653, // 53999.1 ms
      // Glances at his watch at the split marks: overlay only, never jittered.
      marks: [fixed(100, WATCH), fixed(200, WATCH), fixed(300, WATCH)],
      zones: [],
    },
    unit7: {
      reactionMs: 100,
      tau: 2.4,
      vTop: 8.002, // 52503.0 ms
      marks: [jit(100, say('overclock')), jit(250), jit(300, say('overheat')), jit(330)],
      zones: [
        { from: 0, to: 1, mult: 1.08, effect: 'overclock' },
        { from: 2, to: 3, mult: 0.75, effect: 'overheat' },
        { from: 3, mult: 0.95 },
      ],
    },
    zyx: {
      reactionMs: 50,
      tau: 1.0,
      vTop: 7.788, // 51396.9 ms
      // Default profile (x0.97 from 200 m, x0.94 from 300 m); pressure shares the 200 m mark.
      marks: [jit(150, warp(10)), jit(330, warp(10)), jit(200), jit(300)],
      zones: [
        { from: 2, to: 3, mult: 0.97 },
        { from: 3, mult: 0.94 },
      ],
      pressure: { from: 2, leadM: 3.0 },
    },
  },
};

export function rivalSpec(event: EventId, id: OpponentId): RivalSpec {
  const spec = RIVAL_SPECS[event][id];
  if (spec === undefined) throw new Error(`${id} does not race the ${event}`);
  return spec;
}
