import type { RaceEvent } from '../index.ts';
import { ticks } from '../clock/clock.ts';
import type { StepFilter } from '../input/steps.ts';
import { TUNING } from '../roster.ts';
import type { PlayerBody } from '../runner/player.ts';

const FALL_TICKS = ticks(TUNING.TRIP_BLEED_MS);
const LIE_TICKS = ticks(TUNING.TRIP_LIE_MS);
const GETUP_TICKS = ticks(TUNING.TRIP_GETUP_MS);

export type TripPhase = 'none' | 'fall' | 'lie' | 'getup';

/**
 * The player's deterministic trip (design 33, rule C), behind the race's `trip` flag. The race
 * decides when a pair of fumbles triggers it (keyboard only); this owns the phases:
 * fall (speed to 0 linearly over TRIP_BLEED), lie (speed 0 for TRIP_LIE), then get up at
 * TRIP_KEEP x the speed at the trigger with either side accepted next. A trigger in the air starts
 * the fall at landing. 'getup' is a visual phase only: the runner is already up and running.
 */
export class TripState {
  phase: TripPhase = 'none';
  /** Triggered in the air: the fall starts at landing. */
  private pending = false;
  private elapsed = 0;
  private v0 = 0;
  private vTrigger = 0;
  /** Trips started (fumble logging, 33.5). */
  count = 0;
  readonly enabled: boolean;

  constructor(enabled: boolean) {
    this.enabled = enabled;
  }

  /** Inputs are ignored from the trigger until the runner is up again (33.2). */
  get active(): boolean {
    return this.pending || this.phase === 'fall' || this.phase === 'lie';
  }

  /** A rule C pair completed by a key. Returns the 'trip' event when the fall starts now. */
  trigger(body: PlayerBody): RaceEvent | null {
    if (!this.enabled || this.active) return null;
    this.vTrigger = body.v;
    if (body.airborne) {
      this.pending = true;
      return null;
    }
    return this.start(body);
  }

  private start(body: PlayerBody): RaceEvent {
    this.pending = false;
    this.phase = 'fall';
    this.elapsed = 0;
    this.v0 = body.v;
    this.count += 1;
    body.forcedV = body.v;
    return { type: 'trip' };
  }

  /** Before the body's step at race ms `t0`: sets the forced speed; returns 'tripUp' on getting up. */
  beforeStep(body: PlayerBody, filter: StepFilter, t0: number): RaceEvent | null {
    if (this.phase === 'getup') {
      this.elapsed += 1;
      if (this.elapsed >= GETUP_TICKS) this.phase = 'none';
      return null;
    }
    if (this.phase !== 'fall' && this.phase !== 'lie') return null;
    const e = this.elapsed;
    this.elapsed += 1;
    if (e < FALL_TICKS) {
      body.forcedV = this.v0 * (1 - e / FALL_TICKS);
      return null;
    }
    if (e < FALL_TICKS + LIE_TICKS) {
      this.phase = 'lie';
      body.forcedV = 0;
      return null;
    }
    // Get up: keep 30% of the speed at the trigger; the next step may be either side.
    this.phase = 'getup';
    this.elapsed = 0;
    body.forcedV = null;
    body.v = TUNING.TRIP_KEEP * this.vTrigger;
    filter.lastSide = null;
    filter.lastStepMs = t0;
    return { type: 'tripUp' };
  }

  /** After the body's step: a pending (airborne) trigger starts the fall on the landing tick. */
  afterStep(body: PlayerBody): RaceEvent | null {
    if (this.pending && body.landedThisTick) return this.start(body);
    return null;
  }

  clone(): TripState {
    const c = new TripState(this.enabled);
    c.phase = this.phase;
    c.pending = this.pending;
    c.elapsed = this.elapsed;
    c.v0 = this.v0;
    c.vTrigger = this.vTrigger;
    c.count = this.count;
    return c;
  }
}
