/**
 * Throwaway prototype (question 2): the real player model (core PlayerBody + StepFilter, design 2.2
 * and 2.3) wrapped with an optional deterministic trip. Shared by trip.ts (playable) and trip-sim.ts
 * (headless, plain `node`), so both measure exactly the same rule.
 *
 * Rules:
 *   A    today: a same-side press is a fumble (zero impulse), nothing else.
 *   B    trip when a fumble comes within W seconds of an earlier fumble (2 same-side presses in W).
 *   B1   stricter reading: trip on any fumble that comes within W of the previous press on that side
 *        (a single double tap). At mashing speed that is every fumble.
 *   C    trip on 2 fumbles in a row (no valid step between them, i.e. 3 same-side presses) within W.
 * Trip: speed bleeds linearly to 0 over BLEED, the runner lies for L, then gets up with
 * (1 - speedLoss) of the pre-trip speed (speedLoss 1 = restart from 0). Presses during the trip
 * do nothing; after it either side is accepted again.
 */
import { DT_MS } from '../../src/core/clock/clock.ts';
import type { Side } from '../../src/core/index.ts';
import { StepFilter } from '../../src/core/input/steps.ts';
import { PlayerBody } from '../../src/core/runner/player.ts';

export type Rule = 'A' | 'B' | 'B1' | 'C';

export interface TripParams {
  readonly rule: Rule;
  readonly windowS: number;
  readonly lieS: number;
  readonly bleedS: number;
  /** 0-1: share of the pre-trip speed lost when the runner gets up. */
  readonly speedLoss: number;
}

export const DEFAULT_TRIP: TripParams = { rule: 'B', windowS: 0.5, lieS: 0.4, bleedS: 0.25, speedLoss: 1 };

export type PressResult = 'step' | 'fumble' | 'trip' | 'ignored';
export type Pose = 'run' | 'fall' | 'down';

export class TripRace {
  readonly body = new PlayerBody('100m');
  readonly filter = new StepFilter();
  readonly p: TripParams;
  tick = 0;
  trips = 0;
  fumbles = 0;
  steps = 0;
  private lastFumbleMs = Number.NEGATIVE_INFINITY;
  /** True while the last press was a fumble (rule C). */
  private fumbleStreak = false;
  private lastPress: Record<Side, number> = { L: Number.NEGATIVE_INFINITY, R: Number.NEGATIVE_INFINITY };
  private trip: { readonly startMs: number; readonly v0: number } | null = null;

  constructor(p: TripParams) {
    this.p = p;
  }

  get ms(): number {
    return this.tick * DT_MS;
  }

  get finished(): boolean {
    return this.body.finishMs !== null;
  }

  pose(): Pose {
    if (!this.trip) return 'run';
    return this.ms - this.trip.startMs < this.p.bleedS * 1000 ? 'fall' : 'down';
  }

  /** A keydown at race ms `ms` (call advanceTo(ms) first). */
  press(side: Side, ms: number, repeat = false): PressResult {
    if (this.trip) return 'ignored';
    const prevSame = this.lastPress[side];
    const verdict = this.filter.down(side, ms, repeat);
    if (verdict === 'ignored') return 'ignored';
    this.lastPress[side] = ms;
    if (verdict === 'step') {
      this.body.impulse(ms, null);
      this.steps += 1;
      this.fumbleStreak = false;
      return 'step';
    }
    this.fumbles += 1;
    const w = this.p.windowS * 1000;
    let trip = false;
    if (this.p.rule === 'B') trip = ms - this.lastFumbleMs <= w;
    if (this.p.rule === 'B1') trip = ms - prevSame <= w;
    if (this.p.rule === 'C') trip = this.fumbleStreak && ms - this.lastFumbleMs <= w;
    this.lastFumbleMs = ms;
    this.fumbleStreak = true;
    if (!trip) return 'fumble';
    this.trips += 1;
    this.trip = { startMs: ms, v0: this.body.v };
    this.lastFumbleMs = Number.NEGATIVE_INFINITY;
    this.fumbleStreak = false;
    return 'trip';
  }

  release(side: Side): void {
    this.filter.release(side);
  }

  /** Run fixed 120 Hz ticks up to race ms `ms`. */
  advanceTo(ms: number): void {
    while (this.tick * DT_MS < ms && !this.finished) this.step();
  }

  private step(): void {
    const t0 = this.ms;
    let idle = t0 - (this.filter.lastStepMs ?? 0);
    if (this.trip) {
      const e = (t0 - this.trip.startMs) / 1000;
      const bleed = this.p.bleedS;
      if (e < bleed) {
        this.body.v = this.trip.v0 * (1 - e / bleed);
      } else if (e < bleed + this.p.lieS) {
        this.body.v = 0;
      } else {
        // Get up: restart with what is left of the pre-trip speed; either side starts again.
        this.body.v = this.trip.v0 * (1 - this.p.speedLoss);
        this.trip = null;
        this.filter.lastSide = null;
        this.filter.lastStepMs = t0;
      }
      idle = 0;
    }
    this.body.step(t0, idle, null);
    this.tick += 1;
  }
}
