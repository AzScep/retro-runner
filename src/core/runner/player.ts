import type { EventId, RaceEvent } from '../index.ts';
import { DT_MS, DT_S, ticks } from '../clock/clock.ts';
import { EVENT_COURSE, EVENTS, hurdlePositions } from '../events.ts';
import { TUNING, WORLD } from '../roster.ts';

/** Shared crossing rule (design 2.6): interpolated race ms at which x passes the mark `atM`. */
export function crossingMs(t0Ms: number, xPrev: number, xNow: number, atM: number): number {
  return Math.round(t0Ms + (DT_MS * (atM - xPrev)) / (xNow - xPrev));
}

export const JUMP_AIR_S = TUNING.JUMP_AIR_MS / 1000;
const AIR_TICKS = ticks(TUNING.JUMP_AIR_MS);
const LOCK_TICKS = ticks(TUNING.JUMP_LOCK_MS);
const STUMBLE_TICKS = ticks(TUNING.HIT_STUMBLE_MS);
const LOW_EVERY_TICKS = ticks(TUNING.STAMINA_LOW_EVERY_MS);

/** Airtime in ticks (48). */
export function airTicksTotal(): number {
  return AIR_TICKS;
}

/** Feet height for arc phase s in [0, 1] (design 13.2). */
export function arcHeight(s: number): number {
  return 4 * TUNING.JUMP_PEAK_M * s * (1 - s);
}

export type HurdleResult = 'clean' | 'clip' | 'hit';

/**
 * Design 13.2 hurdle check for a tick that moves x from `xPrev` to `xNow` past hurdle `h`.
 * `airTicks` is the number of airborne ticks completed before this one (null when grounded);
 * the arc phase is interpolated to the crossing instant within the tick.
 */
export function hurdleOutcome(airTicks: number | null, xPrev: number, xNow: number, h: number): HurdleResult {
  if (airTicks === null) return 'hit';
  const f = (h - xPrev) / (xNow - xPrev);
  const s = (airTicks + f) / AIR_TICKS;
  return arcHeight(s) >= TUNING.HURDLE_HEIGHT_M ? 'clean' : 'clip';
}

/** 400 m speed cap for stamina S (design 14.1). */
export function staminaCap(s: number): number {
  if (s >= TUNING.S_FATIGUE) return WORLD.V_MAX;
  return TUNING.V_TIRED + ((WORLD.V_MAX - TUNING.V_TIRED) * s) / TUNING.S_FATIGUE;
}

/**
 * Player body: mash-to-speed (design 2.3), plus the hurdles jump model (13.2) and the 400 m stamina
 * model (14.1) when the event has them. Events go to the `out` array given to each call (null for
 * off-screen copies).
 */
export class PlayerBody {
  x = 0;
  /** Position at the previous tick, for render interpolation. */
  xPrev = 0;
  v = 0;
  finishMs: number | null = null;
  /** Cleared on DNF: crossing the line afterwards records nothing. */
  finishable = true;

  /** Hurdles: ticks since takeoff while airborne, else null. */
  airTicks: number | null = null;
  /** True for the tick that landed, so rendering (one tick behind) can finish the arc. */
  landedThisTick = false;
  /** Ticks left before a jump is accepted (post-landing lock or HIT stumble). */
  lockTicks = 0;
  /** Ticks left of a HIT stumble: no impulse, no idle braking. */
  stumbleTicks = 0;
  readonly knocked: boolean[];
  /** Index of the next hurdle ahead. */
  nextHurdle = 0;

  /** 400 m: stamina 0-1, else null. */
  stamina: number | null;
  readonly splits: number[] = [];
  private lowTicks = 0;
  private lastEmptyMs = Number.NEGATIVE_INFINITY;

  readonly event: EventId;
  readonly distanceM: number;
  readonly hurdleX: readonly number[];
  private readonly maxX: number;
  private readonly splitsM: readonly number[];
  private readonly bellAtM: number | null;

  constructor(event: EventId = '100m') {
    this.event = event;
    this.distanceM = EVENTS[event].distanceM;
    this.maxX = this.distanceM + WORLD.RUN_OUT_M;
    this.hurdleX = hurdlePositions(event);
    this.knocked = this.hurdleX.map(() => false);
    this.stamina = event === '400m' ? 1 : null;
    this.splitsM = EVENT_COURSE[event].splitsM;
    this.bellAtM = EVENT_COURSE[event].bellAtM;
  }

  get airborne(): boolean {
    return this.airTicks !== null;
  }

  /** Design 13.2 "accepted when" (the race checks the phase). */
  canJump(): boolean {
    return (
      this.hurdleX.length > 0 &&
      this.airTicks === null &&
      this.lockTicks === 0 &&
      this.finishMs === null &&
      this.finishable
    );
  }

  jump(): void {
    this.airTicks = 0;
  }

  /** Current speed cap (V_MAX outside the 400 m). */
  cap(): number {
    return this.stamina === null ? WORLD.V_MAX : staminaCap(this.stamina);
  }

  /**
   * A valid step at race time `tMs`. Returns false when it gives no impulse (in the air or
   * stumbling). In the 400 m the step costs stamina even when the speed is at or above the cap.
   */
  impulse(tMs: number, out: RaceEvent[] | null): boolean {
    if (this.airTicks !== null || this.stumbleTicks > 0) return false;
    if (this.stamina === null) {
      this.v = Math.min(this.v + TUNING.STEP_IMPULSE, WORLD.V_MAX);
      return true;
    }
    const before = this.stamina;
    this.stamina = Math.max(0, this.stamina - TUNING.STEP_COST);
    if (before > 0 && this.stamina === 0 && tMs - this.lastEmptyMs >= TUNING.STAMINA_EMPTY_EVERY_MS) {
      this.lastEmptyMs = tMs;
      out?.push({ type: 'staminaEmpty' });
    }
    const vCap = staminaCap(this.stamina);
    if (this.v < vCap) this.v = Math.min(this.v + TUNING.STEP_IMPULSE, vCap);
    return true;
  }

  /**
   * One 1/120 s step starting at race time `t0Ms`, `idleMs` after the last valid step.
   * Returns true on the tick that crosses the finish (finishMs is then set).
   */
  step(t0Ms: number, idleMs: number, out: RaceEvent[] | null): boolean {
    if (this.stamina !== null) this.stamina = Math.min(1, this.stamina + TUNING.REGEN * DT_S);
    if (this.airTicks === null) {
      // In the air speed is frozen: no drag, no idle braking (13.2).
      this.v -= TUNING.K_DRAG * this.v * DT_S;
      if (this.stamina !== null) {
        const vCap = staminaCap(this.stamina);
        if (this.v > vCap) this.v = Math.max(vCap, this.v - TUNING.FATIGUE_DECEL * DT_S);
      }
      if (idleMs > TUNING.IDLE_GRACE_MS && this.stumbleTicks === 0) {
        this.v = Math.max(0, this.v - TUNING.IDLE_DECEL * DT_S);
      }
    }
    this.xPrev = this.x;
    this.x += this.v * DT_S;
    if (this.x >= this.maxX) {
      this.x = this.maxX;
      this.v = 0;
    }
    if (this.lockTicks > 0) this.lockTicks -= 1;
    if (this.stumbleTicks > 0) this.stumbleTicks -= 1;

    this.checkHurdle(out);
    this.landedThisTick = false;
    if (this.airTicks !== null) {
      this.airTicks += 1;
      if (this.airTicks >= AIR_TICKS) {
        this.airTicks = null;
        this.landedThisTick = true;
        this.v *= TUNING.LAND_KEEP;
        this.lockTicks = LOCK_TICKS;
        out?.push({ type: 'land', lane: 'player' });
      }
    }

    const racing = this.finishable && this.finishMs === null;
    if (racing) this.checkSplits(t0Ms, out);
    if (racing && this.stamina !== null) this.checkLow(out);

    if (racing && this.x >= this.distanceM) {
      this.finishMs = crossingMs(t0Ms, this.xPrev, this.x, this.distanceM);
      return true;
    }
    return false;
  }

  private checkHurdle(out: RaceEvent[] | null): void {
    const i = this.nextHurdle;
    const h = this.hurdleX[i];
    if (h === undefined || !(this.xPrev < h && h <= this.x)) return;
    this.nextHurdle += 1;
    const result = hurdleOutcome(this.airTicks, this.xPrev, this.x, h);
    if (result === 'clean') {
      out?.push({ type: 'hurdleClear', lane: 'player', index: i });
      return;
    }
    this.knocked[i] = true;
    if (result === 'clip') {
      this.v *= TUNING.CLIP_KEEP;
      out?.push({ type: 'hurdleClip', lane: 'player', index: i });
    } else {
      this.v *= TUNING.HIT_KEEP;
      this.stumbleTicks = STUMBLE_TICKS;
      this.lockTicks = Math.max(this.lockTicks, STUMBLE_TICKS);
      out?.push({ type: 'hurdleHit', lane: 'player', index: i });
    }
  }

  private checkSplits(t0Ms: number, out: RaceEvent[] | null): void {
    const index = this.splits.length;
    const d = this.splitsM[index];
    if (d === undefined || !(this.xPrev < d && d <= this.x)) return;
    const ms = crossingMs(t0Ms, this.xPrev, this.x, d);
    this.splits.push(ms);
    out?.push({ type: 'split', index, ms });
    if (d === this.bellAtM) out?.push({ type: 'bell' });
  }

  private checkLow(out: RaceEvent[] | null): void {
    if ((this.stamina ?? 1) >= TUNING.S_FATIGUE) {
      this.lowTicks = 0;
      return;
    }
    if (this.lowTicks === 0) {
      out?.push({ type: 'staminaLow' });
      this.lowTicks = LOW_EVERY_TICKS;
    }
    this.lowTicks -= 1;
  }

  /** Knocked hurdles so far (CLIP plus HIT). */
  get hit(): number {
    return this.knocked.filter(Boolean).length;
  }

  clone(): PlayerBody {
    const c = new PlayerBody(this.event);
    c.x = this.x;
    c.xPrev = this.xPrev;
    c.v = this.v;
    c.finishMs = this.finishMs;
    c.finishable = this.finishable;
    c.airTicks = this.airTicks;
    c.landedThisTick = this.landedThisTick;
    c.lockTicks = this.lockTicks;
    c.stumbleTicks = this.stumbleTicks;
    c.knocked.splice(0, c.knocked.length, ...this.knocked);
    c.nextHurdle = this.nextHurdle;
    c.stamina = this.stamina;
    c.splits.push(...this.splits);
    c.lowTicks = this.lowTicks;
    c.lastEmptyMs = this.lastEmptyMs;
    return c;
  }
}
