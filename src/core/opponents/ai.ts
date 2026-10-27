import type { OpponentId, RaceEvent, RunnerEffect } from '../index.ts';
import { DT_S, ticks } from '../clock/clock.ts';
import { uniform } from '../rng/mulberry32.ts';
import { TUNING, WORLD } from '../roster.ts';
import { crossingMs, MAX_X_M } from '../runner/player.ts';

type QuirkName = Extract<RaceEvent, { type: 'quirk' }>['name'];

export interface RivalProfile {
  readonly reactionMs: number;
  /** Speed approach time constant in s. */
  readonly tau: number;
  /** Cruise speed in m/s, tuned headlessly (see vtop.test.ts). */
  readonly vTop: number;
}

/**
 * Design 3.2 REACTION and TAU, plus V_TOP tuned by a headless sweep of 1000 seeded races per rival
 * (opponents/vtop.test.ts) so the mean finish matches the target within +/-0.05 s.
 * Design starting values, for reference: 6.55, 7.70, 8.77, 8.99, 9.63, 11.74, 10.18.
 */
export const RIVAL_PROFILES: Readonly<Record<OpponentId, RivalProfile>> = {
  // Tuned 2026-10-27 by bisection; measured mean over the test's 1000 seeds in the comment.
  pip: { reactionMs: 300, tau: 1.5, vTop: 6.383 }, // 17999.6 ms
  jess: { reactionMs: 250, tau: 1.2, vTop: 7.628 }, // 15000.7 ms
  marco: { reactionMs: 220, tau: 1.8, vTop: 8.757 }, // 13600.0 ms
  kofi: { reactionMs: 180, tau: 1.4, vTop: 9.025 }, // 12599.5 ms
  valentina: { reactionMs: 140, tau: 1.2, vTop: 9.666 }, // 11599.5 ms
  unit7: { reactionMs: 100, tau: 2.4, vTop: 11.604 }, // 11000.1 ms
  zyx: { reactionMs: 50, tau: 1.0, vTop: 10.158 }, // 10400.0 ms (pressure excluded)
};

/** Quirk trigger distances in m before the seeded +/-3 m shift, in draw order. */
const BASE_TRIGGERS: Readonly<Record<OpponentId, readonly number[]>> = {
  pip: [45, 80], // trip, wave
  jess: [60], // fade
  marco: [30], // coast start (window is 20 m long)
  kofi: [80], // kick
  valentina: [70], // kick + flashbulb
  unit7: [50, 85], // overclock start, overheat start (overheat lasts 7 m)
  zyx: [30, 65, 50], // warp 1, warp 2, pressure allowed from
};

const VTOP_JITTER = 0.01;
const TRIGGER_JITTER_M = 3;
const TRIP_TICKS = ticks(600);
const WAVE_TICKS = ticks(1000);
const VANISH_TICKS = ticks(250);
/** Warp-in overlay length: 6 frames at 20 fps (design 5.6). */
const WARP_IN_TICKS = ticks(300);
const WARP_JUMP_M = 5;
const COAST_LEN_M = 20;
const OVERHEAT_LEN_M = 7;
const PRESSURE_LEAD_M = 1.5;

/** Per-race random draws: V_TOP factor and shifted trigger distances. */
export interface RivalPlan {
  readonly vTop: number;
  readonly at: readonly number[];
}

export function planRival(id: OpponentId, rng: () => number, vTopOverride?: number): RivalPlan {
  const base = vTopOverride ?? RIVAL_PROFILES[id].vTop;
  const vTop = base * uniform(rng, 1 - VTOP_JITTER, 1 + VTOP_JITTER);
  const at = BASE_TRIGGERS[id].map((d) => d + uniform(rng, -TRIGGER_JITTER_M, TRIGGER_JITTER_M));
  return { vTop, at };
}

/**
 * AI runner (design 3.1): exponential approach to V_TOP x quirk multiplier.
 * Deterministic given its plan and the player positions it is shown (Zyx pressure only).
 */
export class RivalSim {
  x = 0;
  xPrev = 0;
  v = 0;
  finishMs: number | null = null;
  private fired: boolean[];
  private tripTicks = 0;
  private waveTicks = 0;
  private vanishTicks = 0;
  private warpInTicks = 0;
  private pressure = false;
  private readonly profile: RivalProfile;
  readonly id: OpponentId;
  readonly plan: RivalPlan;

  constructor(id: OpponentId, plan: RivalPlan) {
    this.id = id;
    this.plan = plan;
    this.profile = RIVAL_PROFILES[id];
    this.fired = plan.at.map(() => false);
  }

  clone(): RivalSim {
    const c = new RivalSim(this.id, this.plan);
    c.x = this.x;
    c.xPrev = this.xPrev;
    c.v = this.v;
    c.finishMs = this.finishMs;
    c.fired = [...this.fired];
    c.tripTicks = this.tripTicks;
    c.waveTicks = this.waveTicks;
    c.vanishTicks = this.vanishTicks;
    c.warpInTicks = this.warpInTicks;
    c.pressure = this.pressure;
    return c;
  }

  get visible(): boolean {
    return this.vanishTicks === 0;
  }

  get tripping(): boolean {
    return this.tripTicks > 0;
  }

  get effect(): RunnerEffect {
    if (this.vanishTicks > 0) return 'warpOut';
    if (this.warpInTicks > 0) return 'warpIn';
    if (this.waveTicks > 0) return 'wave';
    if (this.id === 'unit7' && this.finishMs === null) {
      const [oc = 0, heat = 0] = this.plan.at;
      if (this.x >= heat && this.x < heat + OVERHEAT_LEN_M) return 'overheat';
      if (this.x >= oc && this.x < heat) return 'overclock';
    }
    return 'none';
  }

  /** Quirk multiplier on V_TOP for the current state. */
  private multiplier(): number {
    const x = this.x;
    const at = this.plan.at;
    switch (this.id) {
      case 'pip':
        if (this.tripTicks > 0) return 0.3;
        if (this.waveTicks > 0) return 0.85;
        return 1;
      case 'jess':
        return x >= (at[0] ?? 0) ? 0.9 : 1;
      case 'marco': {
        const start = at[0] ?? 0;
        return x >= start && x < start + COAST_LEN_M ? 0.93 : 1;
      }
      case 'kofi':
        return x >= (at[0] ?? 0) ? 1.05 : 1;
      case 'valentina':
        return x >= (at[0] ?? 0) ? 1.04 : 1;
      case 'unit7': {
        const [oc = 0, heat = 0] = at;
        if (x >= heat && x < heat + OVERHEAT_LEN_M) return 0.8;
        if (x >= oc && x < heat) return 1.06;
        return 1;
      }
      case 'zyx':
        return this.pressure ? 1.03 : 1;
    }
  }

  /**
   * One 1/120 s step starting at race time `t0Ms`. `playerX` is the player's position at the start
   * of the step, or null to ignore the player (headless tuning). Quirk and finish events go to `out`.
   */
  step(t0Ms: number, playerX: number | null, out: RaceEvent[] | null): void {
    this.xPrev = this.x;
    if (this.vanishTicks > 0) {
      // Mid-warp: no movement, speed kept.
      this.vanishTicks -= 1;
      if (this.vanishTicks === 0) {
        this.x += WARP_JUMP_M;
        this.xPrev = this.x;
        this.warpInTicks = WARP_IN_TICKS;
        out?.push({ type: 'quirk', name: 'warpIn' });
      }
      return;
    }
    if (t0Ms < this.profile.reactionMs) return;

    if (this.id === 'zyx' && this.finishMs === null && playerX !== null) {
      const lead = playerX - this.x;
      if (!this.pressure && this.x > (this.plan.at[2] ?? 0) && lead > PRESSURE_LEAD_M) {
        this.pressure = true;
        out?.push({ type: 'quirk', name: 'pressure' });
      } else if (this.pressure && lead <= 0) {
        this.pressure = false;
      }
    }

    const finished = this.finishMs !== null;
    const target = finished ? 0 : this.plan.vTop * this.multiplier();
    this.v += ((target - this.v) * DT_S) / this.profile.tau;
    // Run-out: besides target 0 with its tau, brake like an idle player so every rival stops
    // inside the 20 m run-out (UNIT-7's 2.4 s tau alone would need ~29 m).
    if (finished) this.v = Math.max(0, this.v - TUNING.IDLE_DECEL * DT_S);
    this.x += this.v * DT_S;
    if (this.x >= MAX_X_M) {
      this.x = MAX_X_M;
      this.v = 0;
    }

    if (this.tripTicks > 0) this.tripTicks -= 1;
    if (this.waveTicks > 0) this.waveTicks -= 1;
    if (this.warpInTicks > 0) this.warpInTicks -= 1;

    if (!finished && this.x >= WORLD.RACE_DISTANCE_M) {
      this.finishMs = crossingMs(t0Ms, this.xPrev, this.x);
      out?.push({ type: 'rivalFinish', ms: this.finishMs });
    }
    if (!finished) this.checkTriggers(out);
  }

  private checkTriggers(out: RaceEvent[] | null): void {
    const at = this.plan.at;
    for (let i = 0; i < at.length; i++) {
      if (this.fired[i] || this.x < (at[i] ?? 0)) continue;
      this.fired[i] = true;
      for (const name of this.fire(i)) out?.push({ type: 'quirk', name });
    }
  }

  /** Starts quirk `i` and returns the events it announces. */
  private fire(i: number): QuirkName[] {
    switch (this.id) {
      case 'pip':
        if (i === 0) {
          this.tripTicks = TRIP_TICKS;
          return ['trip'];
        }
        this.waveTicks = WAVE_TICKS;
        return ['wave'];
      case 'jess':
        return ['fade'];
      case 'marco':
        return ['coast'];
      case 'kofi':
        return ['kick'];
      case 'valentina':
        return ['kick', 'flashbulb'];
      case 'unit7':
        return i === 0 ? ['overclock'] : ['overheat'];
      case 'zyx':
        if (i === 2) return []; // pressure threshold, announced when it bites
        this.vanishTicks = VANISH_TICKS;
        return ['warpOut'];
    }
  }
}

/** Headless: run a rival alone from GO until it crosses; returns its finish ms. */
export function simulateRivalFinish(sim: RivalSim, maxMs = 60000): number | null {
  const limit = ticks(maxMs);
  for (let k = 0; k < limit && sim.finishMs === null; k++) sim.step((k * 1000) / WORLD.SIM_HZ, null, null);
  return sim.finishMs;
}
