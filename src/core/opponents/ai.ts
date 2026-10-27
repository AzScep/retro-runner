import type { EventId, OpponentId, QuirkName, RaceEvent, RunnerEffect } from '../index.ts';
import { DT_S, ticks } from '../clock/clock.ts';
import { EVENTS, hurdlePositions } from '../events.ts';
import { uniform } from '../rng/mulberry32.ts';
import { TUNING, WORLD } from '../roster.ts';
import { airTicksTotal, crossingMs, hurdleOutcome, JUMP_AIR_S } from '../runner/player.ts';
import { rivalSpec, type HurdleAction, type RivalSpec, type ZoneSpec } from './specs.ts';

const VANISH_TICKS = ticks(250);
/** Warp-in overlay length: 6 frames at 20 fps (design 5.6). */
const WARP_IN_TICKS = ticks(300);
const LOCK_TICKS = ticks(TUNING.JUMP_LOCK_MS);
const AIR_TICKS = airTicksTotal();
const HIT_STUMBLE: Active = {
  ticks: ticks(TUNING.AI_HIT_MS),
  mult: TUNING.AI_HIT_MULT,
  effect: null,
  stumble: true,
};

/** Per-race random draws: V_TOP factor, shifted mark distances and hurdle outcomes. */
export interface RivalPlan {
  readonly vTop: number;
  /** Resolved mark distances, index-aligned with the spec's marks. */
  readonly at: readonly number[];
  /** Per hurdle (110mh), else []. */
  readonly hurdles: readonly HurdleAction[];
}

export function quirkJitterM(event: EventId): number {
  return event === '400m' ? TUNING.AI_QUIRK_JITTER_400_M : TUNING.AI_QUIRK_JITTER_M;
}

/**
 * Draw order (stable, so a seed always means the same race): V_TOP factor, then each jittered mark
 * in spec order, then one draw per hurdle (110mh) whether or not a script overrides it.
 */
export function planRival(
  event: EventId,
  id: OpponentId,
  rng: () => number,
  vTopOverride?: number,
): RivalPlan {
  const spec = rivalSpec(event, id);
  const base = vTopOverride ?? spec.vTop;
  const vTop = base * uniform(rng, 1 - TUNING.AI_VTOP_JITTER, 1 + TUNING.AI_VTOP_JITTER);
  const j = quirkJitterM(event);
  const at = spec.marks.map((m) => (m.jitter ? m.at + uniform(rng, -j, j) : m.at));
  const hs = spec.hurdles;
  const hurdles =
    hs === undefined
      ? []
      : hurdlePositions(event).map((_, i): HurdleAction => {
          const draw = rng();
          return hs.script[i] ?? (draw < hs.pClip ? 'clip' : 'clean');
        });
  return { vTop, at, hurdles };
}

interface Active {
  ticks: number;
  readonly mult: number;
  readonly effect: RunnerEffect | null;
  readonly stumble: boolean;
}

/**
 * AI runner (design 3.1, 15.2): exponential approach to V_TOP x multiplier, where the multiplier is
 * the product of the active distance zones, the strongest active timed quirk and Zyx's pressure.
 * Hurdles use the player's jump physics. Deterministic given its plan and the player positions it
 * is shown (Zyx pressure only).
 */
export class RivalSim {
  x = 0;
  xPrev = 0;
  v = 0;
  finishMs: number | null = null;
  /** Ticks since takeoff while airborne, else null. */
  airTicks: number | null = null;
  /** True for the tick that landed, so rendering (one tick behind) can finish the arc. */
  landedThisTick = false;
  readonly knocked: boolean[];
  private lockTicks = 0;
  private nextHurdle = 0;
  private fired: boolean[];
  private active: Active[] = [];
  private vanishTicks = 0;
  private warpJumpM = 0;
  private warpInTicks = 0;
  private pressure = false;
  private readonly spec: RivalSpec;
  private readonly hurdleX: readonly number[];
  private readonly distanceM: number;
  private readonly maxX: number;
  readonly event: EventId;
  /** Named rival id, null for a field runner. */
  readonly id: OpponentId | null;
  readonly plan: RivalPlan;
  /** [v3] Lane carried by its events: 1 = named rival, 2-5 = field. */
  readonly lane: number;

  /**
   * A named rival (`id`, spec from RIVAL_SPECS) or, with `id` null, a field runner driven by the
   * synthetic `spec` of field/field.ts (design 25.1).
   */
  constructor(event: EventId, id: OpponentId | null, plan: RivalPlan, spec?: RivalSpec, lane = 1) {
    this.event = event;
    this.id = id;
    this.plan = plan;
    this.lane = lane;
    if (spec === undefined && id === null) throw new Error('a field runner needs a spec');
    this.spec = spec ?? rivalSpec(event, id as OpponentId);
    this.hurdleX = hurdlePositions(event);
    this.knocked = this.hurdleX.map(() => false);
    this.distanceM = EVENTS[event].distanceM;
    this.maxX = this.distanceM + WORLD.RUN_OUT_M;
    this.fired = plan.at.map(() => false);
  }

  clone(): RivalSim {
    const c = new RivalSim(this.event, this.id, this.plan, this.spec, this.lane);
    c.x = this.x;
    c.xPrev = this.xPrev;
    c.v = this.v;
    c.finishMs = this.finishMs;
    c.airTicks = this.airTicks;
    c.landedThisTick = this.landedThisTick;
    c.knocked.splice(0, c.knocked.length, ...this.knocked);
    c.lockTicks = this.lockTicks;
    c.nextHurdle = this.nextHurdle;
    c.fired = [...this.fired];
    c.active = this.active.map((a) => ({ ...a }));
    c.vanishTicks = this.vanishTicks;
    c.warpJumpM = this.warpJumpM;
    c.warpInTicks = this.warpInTicks;
    c.pressure = this.pressure;
    return c;
  }

  get visible(): boolean {
    return this.vanishTicks === 0;
  }

  /** Stumble anim: trip, or a hurdle HIT. */
  get tripping(): boolean {
    return this.active.some((a) => a.stumble);
  }

  get effect(): RunnerEffect {
    if (this.vanishTicks > 0) return 'warpOut';
    if (this.warpInTicks > 0) return 'warpIn';
    for (const a of this.active) if (a.effect !== null && a.effect !== 'watch') return a.effect;
    for (const a of this.active) if (a.effect === 'watch') return 'watch';
    if (this.finishMs === null) {
      for (const z of this.spec.zones) if (z.effect !== undefined && this.inZone(z)) return z.effect;
    }
    return 'none';
  }

  private zoneStart(z: ZoneSpec): number {
    return z.from === undefined ? Number.NEGATIVE_INFINITY : (this.plan.at[z.from] ?? 0);
  }

  private inZone(z: ZoneSpec): boolean {
    const start = this.zoneStart(z);
    if (this.x < start) return false;
    if (z.to !== undefined) return this.x < (this.plan.at[z.to] ?? 0);
    if (z.len !== undefined) return this.x < start + z.len;
    return true;
  }

  /** Multiplier on V_TOP for the current state. */
  private multiplier(): number {
    let m = 1;
    for (const z of this.spec.zones) if (this.inZone(z)) m *= z.mult;
    let timed = 1;
    for (const a of this.active) timed = Math.min(timed, a.mult);
    return m * timed * (this.pressure ? 1.03 : 1);
  }

  /**
   * One 1/120 s step starting at race time `t0Ms`. `playerX` is the player's position at the start
   * of the step, or null to ignore the player (headless tuning). Events go to `out`.
   */
  step(t0Ms: number, playerX: number | null, out: RaceEvent[] | null): void {
    this.xPrev = this.x;
    if (this.vanishTicks > 0) {
      // Mid-warp: no movement, speed kept.
      this.vanishTicks -= 1;
      if (this.vanishTicks === 0) {
        this.x += this.warpJumpM;
        this.xPrev = this.x;
        this.warpInTicks = WARP_IN_TICKS;
        // Warped-through hurdles stay standing and are simply behind him now.
        while ((this.hurdleX[this.nextHurdle] ?? Infinity) <= this.x) this.nextHurdle += 1;
        out?.push({ type: 'quirk', name: 'warpIn' });
      }
      return;
    }
    if (t0Ms < this.spec.reactionMs) return;

    const pressure = this.spec.pressure;
    if (pressure !== undefined && this.finishMs === null && playerX !== null) {
      const lead = playerX - this.x;
      if (!this.pressure && this.x > (this.plan.at[pressure.from] ?? 0) && lead > pressure.leadM) {
        this.pressure = true;
        out?.push({ type: 'quirk', name: 'pressure' });
      } else if (this.pressure && lead <= 0) {
        this.pressure = false;
      }
    }

    const finished = this.finishMs !== null;
    if (this.airTicks === null) this.maybeTakeOff(finished, out);
    if (this.airTicks === null) {
      // Grounded: approach the target. Airborne speed is frozen (13.2).
      const target = finished ? 0 : this.plan.vTop * this.multiplier();
      this.v += ((target - this.v) * DT_S) / this.spec.tau;
      // Run-out: besides target 0 with its tau, brake like an idle player so every rival stops
      // inside the 20 m run-out (UNIT-7's 2.4 s tau alone would need ~29 m).
      if (finished) this.v = Math.max(0, this.v - TUNING.IDLE_DECEL * DT_S);
    }
    this.x += this.v * DT_S;
    if (this.x >= this.maxX) {
      this.x = this.maxX;
      this.v = 0;
    }

    for (const a of this.active) a.ticks -= 1;
    this.active = this.active.filter((a) => a.ticks > 0);
    if (this.warpInTicks > 0) this.warpInTicks -= 1;
    if (this.lockTicks > 0) this.lockTicks -= 1;

    this.checkHurdle(out);
    this.landedThisTick = false;
    if (this.airTicks !== null) {
      this.airTicks += 1;
      if (this.airTicks >= AIR_TICKS) {
        this.airTicks = null;
        this.landedThisTick = true;
        this.v *= this.spec.hurdles?.landKeep ?? TUNING.LAND_KEEP;
        this.lockTicks = LOCK_TICKS;
        out?.push({ type: 'land', lane: this.lane });
      }
    }

    if (!finished && this.x >= this.distanceM) {
      this.finishMs = crossingMs(t0Ms, this.xPrev, this.x, this.distanceM);
      out?.push({ type: 'runnerFinish', lane: this.lane, ms: this.finishMs });
      if (this.id !== null) out?.push({ type: 'rivalFinish', ms: this.finishMs });
    }
    if (!finished) this.checkTriggers(out);
  }

  /** Takeoff when (h - x) / v <= TAKEOFF_S * JUMP_AIR for a hurdle he means to jump (15.2). */
  private maybeTakeOff(finished: boolean, out: RaceEvent[] | null): void {
    const h = this.hurdleX[this.nextHurdle];
    const action = this.plan.hurdles[this.nextHurdle];
    if (h === undefined || finished || this.lockTicks > 0 || this.v <= 0) return;
    if (action !== 'clean' && action !== 'clip') return;
    const takeoffS = action === 'clip' ? TUNING.AI_TAKEOFF_CLIP : TUNING.AI_TAKEOFF_CLEAN;
    if ((h - this.x) / this.v > takeoffS * JUMP_AIR_S) return;
    this.airTicks = 0;
    out?.push({ type: 'jump', lane: this.lane });
  }

  private checkHurdle(out: RaceEvent[] | null): void {
    const i = this.nextHurdle;
    const h = this.hurdleX[i];
    if (h === undefined || !(this.xPrev < h && h <= this.x)) return;
    this.nextHurdle += 1;
    const result = hurdleOutcome(this.airTicks, this.xPrev, this.x, h);
    if (result === 'clean') {
      out?.push({ type: 'hurdleClear', lane: this.lane, index: i });
      return;
    }
    this.knocked[i] = true;
    if (result === 'clip') {
      this.v *= TUNING.CLIP_KEEP;
      out?.push({ type: 'hurdleClip', lane: this.lane, index: i });
    } else {
      this.v *= TUNING.HIT_KEEP;
      this.active.push({ ...HIT_STUMBLE });
      out?.push({ type: 'hurdleHit', lane: this.lane, index: i });
    }
  }

  private checkTriggers(out: RaceEvent[] | null): void {
    const at = this.plan.at;
    for (let i = 0; i < at.length; i++) {
      if (this.fired[i] || this.x < (at[i] ?? 0)) continue;
      this.fired[i] = true;
      for (const name of this.fire(i)) out?.push({ type: 'quirk', name });
    }
  }

  /** Starts mark `i`'s action and returns the events it announces. */
  private fire(i: number): readonly QuirkName[] {
    const f = this.spec.marks[i]?.fire;
    switch (f?.kind) {
      case undefined:
      case 'none':
        return [];
      case 'announce':
        return f.names;
      case 'timed':
        this.active.push({
          ticks: ticks(f.ms),
          mult: f.mult,
          effect: f.effect ?? null,
          stumble: f.stumble === true,
        });
        return f.names;
      case 'warp':
        this.vanishTicks = VANISH_TICKS;
        this.warpJumpM = f.jumpM;
        return ['warpOut'];
    }
  }
}

/** Headless: run a rival alone from GO until it crosses; returns its finish ms. */
export function simulateRivalFinish(sim: RivalSim, maxMs = 120000): number | null {
  const limit = ticks(maxMs);
  for (let k = 0; k < limit && sim.finishMs === null; k++) sim.step((k * 1000) / WORLD.SIM_HZ, null, null);
  return sim.finishMs;
}
