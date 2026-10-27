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
  /** Cruise speed in m/s, tuned headlessly with the field (see field/tuning.test.ts). */
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
 * [v3] V_TOP values are retuned together with the field (design 23.2.3, 25.5): a headless sweep of
 * 1000 seeded 5-runner AI races per event and tier (field/tuning.test.ts, pressure excluded) puts
 * the median winning time on the tier target and the named rival's win share at about 0.67. The
 * rival's own mean now ends 0.03-0.23 s slower than the target. Comments give the v2 value and the
 * measured means.
 */
export const RIVAL_SPECS: Readonly<Record<EventId, Readonly<Partial<Record<OpponentId, RivalSpec>>>>> = {
  '100m': {
    pip: {
      reactionMs: 300,
      tau: 1.5,
      vTop: 6.362, // v2 6.383; rival mean 18051.5 ms, field median win 18001 ms
      marks: [jit(45, TRIP), jit(80, WAVE)],
      zones: [],
    },
    jess: {
      reactionMs: 250,
      tau: 1.2,
      vTop: 7.605, // v2 7.628; rival mean 15042.1 ms, field median win 15000 ms
      marks: [jit(60, say('fade'))],
      zones: [{ from: 0, mult: 0.9 }],
    },
    marco: {
      reactionMs: 220,
      tau: 1.8,
      vTop: 8.73, // v2 8.757; rival mean 13635.9 ms, field median win 13600 ms
      marks: [jit(30, say('coast'))],
      zones: [{ from: 0, len: 20, mult: 0.93 }],
    },
    kofi: {
      reactionMs: 180,
      tau: 1.4,
      vTop: 8.996, // v2 9.025; rival mean 12634.9 ms, field median win 12600 ms
      marks: [jit(80, say('kick'))],
      zones: [{ from: 0, mult: 1.05 }],
    },
    valentina: {
      reactionMs: 140,
      tau: 1.2,
      vTop: 9.635, // v2 9.666; rival mean 11632.5 ms, field median win 11600 ms
      marks: [jit(70, say('kick', 'flashbulb'))],
      zones: [{ from: 0, mult: 1.04 }],
    },
    unit7: {
      reactionMs: 100,
      tau: 2.4,
      vTop: 11.569, // v2 11.604; rival mean 11026.1 ms, field median win 11000 ms
      marks: [jit(50, say('overclock')), jit(85, say('overheat'))],
      zones: [
        { from: 0, to: 1, mult: 1.06, effect: 'overclock' },
        { from: 1, len: 7, mult: 0.8, effect: 'overheat' },
      ],
    },
    zyx: {
      reactionMs: 50,
      tau: 1.0,
      vTop: 10.125, // v2 10.158; rival mean 10428.9 ms, field median win 10400 ms
      marks: [jit(30, warp(5)), jit(65, warp(5)), jit(50)],
      zones: [],
      pressure: { from: 2, leadM: 1.5 },
    },
  },
  '110mh': {
    pip: {
      reactionMs: 300,
      tau: 1.5,
      vTop: 6.618, // v2 6.674; rival mean 22141.1 ms, field median win 21999.5 ms
      marks: [jit(100, WAVE)],
      zones: [],
      hurdles: hurdles(0.3, { 2: 'hit', 6: 'hit' }),
    },
    jess: {
      reactionMs: 250,
      tau: 1.2,
      vTop: 7.133, // v2 7.19; rival mean 18727.4 ms, field median win 18601 ms
      marks: [fixed(h(6), say('fade'))],
      zones: [{ from: 0, mult: 0.9 }],
      hurdles: hurdles(0.15),
    },
    marco: {
      reactionMs: 220,
      tau: 1.8,
      vTop: 8.609, // v2 8.699; rival mean 17033.1 ms, field median win 16901 ms
      marks: [fixed(h(3), say('coast')), fixed(h(5))],
      zones: [{ from: 0, to: 1, mult: 0.93 }],
      hurdles: hurdles(0.25),
    },
    kofi: {
      reactionMs: 180,
      tau: 1.4,
      vTop: 8.567, // v2 8.632; rival mean 15694.3 ms, field median win 15599 ms
      marks: [fixed(96, say('kick'))],
      zones: [{ from: 0, mult: 1.08 }],
      hurdles: hurdles(0.1),
    },
    valentina: {
      reactionMs: 140,
      tau: 1.2,
      vTop: 8.914, // v2 8.944; rival mean 14539.9 ms, field median win 14500 ms
      marks: [fixed(h(8), say('kick')), fixed(h(10), say('flashbulb'))],
      zones: [{ from: 0, mult: 1.03 }],
      hurdles: hurdles(0),
    },
    unit7: {
      reactionMs: 100,
      tau: 2.4,
      vTop: 10.359, // v2 10.396; rival mean 13836.1 ms, field median win 13800 ms
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
      vTop: 8.938, // v2 8.968; rival mean 13336.1 ms, field median win 13300 ms
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
    pip: {
      reactionMs: 300,
      tau: 1.5,
      vTop: 6.551, // v2 6.572; rival mean 72228.9 ms, field median win 72001 ms
      marks: [jit(60, say('sweat')), jit(380, WAVE)],
      zones: [
        { to: 0, mult: 1.4 },
        { from: 0, mult: 0.8, effect: 'sweat' },
      ],
    },
    jess: {
      reactionMs: 250,
      tau: 1.2,
      vTop: 6.503, // v2 6.522; rival mean 64182.6 ms, field median win 63997 ms
      marks: [jit(150), jit(250, say('fade'))],
      zones: [
        { to: 0, mult: 1.12 },
        { from: 1, mult: 0.85 },
      ],
    },
    marco: {
      reactionMs: 220,
      tau: 1.8,
      vTop: 7.106, // v2 7.128; rival mean 59177.9 ms, field median win 59001 ms
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
      vTop: 7.343, // v2 7.367; rival mean 56178.7 ms, field median win 56001.5 ms
      marks: [jit(200), jit(320, say('kick'))],
      zones: [
        { from: 0, to: 1, mult: 0.97 },
        { from: 1, mult: 1.04 },
      ],
    },
    sol: {
      reactionMs: 150,
      tau: 1.6,
      vTop: 7.628, // v2 7.653; rival mean 54170.4 ms, field median win 54001 ms
      // Glances at his watch at the split marks: overlay only, never jittered.
      marks: [fixed(100, WATCH), fixed(200, WATCH), fixed(300, WATCH)],
      zones: [],
    },
    unit7: {
      reactionMs: 100,
      tau: 2.4,
      vTop: 7.975, // v2 8.002; rival mean 52673.2 ms, field median win 52502 ms
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
      vTop: 7.761, // v2 7.788; rival mean 51570.6 ms, field median win 51401.5 ms
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
