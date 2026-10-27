import { WORLD } from '../roster.ts';

/** One simulation step in ms (8.333...). */
export const DT_MS = 1000 / WORLD.SIM_HZ;
/** One simulation step in s. */
export const DT_S = 1 / WORLD.SIM_HZ;
/** Max steps simulated by one advance() (250 ms); excess wall time is dropped, not replayed. */
export const MAX_CATCHUP_TICKS = Math.round(0.25 * WORLD.SIM_HZ);

/** Whole ticks for a duration in ms (all design durations are multiples of 1/120 s after rounding). */
export function ticks(ms: number): number {
  return Math.round((ms * WORLD.SIM_HZ) / 1000);
}

/** Tick boundary at which an input at sim time `simMs` is applied: the first boundary at or after it. */
export function boundaryTick(simMs: number): number {
  return Math.ceil((simMs * WORLD.SIM_HZ) / 1000 - 1e-9);
}

/**
 * Maps performance.now() wall time to simulation time.
 * Sim time = wall - startT - offset, where offset accumulates paused time, the post-resume freeze
 * and any catch-up time dropped by the cap. The sim never runs while paused or frozen.
 */
export class SimClock {
  private offset = 0;
  private pausedAt: number | null = null;
  private freezeEnd = Number.NEGATIVE_INFINITY;

  private readonly startT: number;

  constructor(startT: number) {
    this.startT = startT;
  }

  get paused(): boolean {
    return this.pausedAt !== null;
  }

  /** True while paused or inside the post-resume freeze: run keys then only update held state. */
  isFrozenAt(wall: number): boolean {
    return this.pausedAt !== null || wall < this.freezeEnd;
  }

  /** True during the 0.5 s "GET SET" beat after resume. */
  inFreeze(wall: number): boolean {
    return this.pausedAt === null && wall < this.freezeEnd;
  }

  simMs(wall: number): number {
    return wall - this.startT - this.offset;
  }

  /** Sim ms "now", holding still while paused or frozen. */
  private effectiveSimMs(now: number): number {
    const wall = this.pausedAt ?? Math.max(now, this.freezeEnd);
    return this.simMs(wall);
  }

  pause(now: number): void {
    if (this.pausedAt === null) this.pausedAt = now;
  }

  resume(now: number, freezeMs: number): void {
    if (this.pausedAt === null) return;
    this.offset += Math.max(0, now - this.pausedAt) + freezeMs;
    this.freezeEnd = now + freezeMs;
    this.pausedAt = null;
  }

  /** The tick the sim should reach by `now`, never behind `tick`, capped at MAX_CATCHUP_TICKS ahead. */
  targetTick(now: number, tick: number): number {
    const want = Math.floor((this.effectiveSimMs(now) * WORLD.SIM_HZ) / 1000 + 1e-9);
    if (want - tick > MAX_CATCHUP_TICKS) {
      this.offset += (want - tick - MAX_CATCHUP_TICKS) * DT_MS;
      return tick + MAX_CATCHUP_TICKS;
    }
    return Math.max(tick, want);
  }

  /**
   * Render interpolation factor in [0, 1]: blend the previous and current tick states by it
   * (the classic fixed-timestep scheme, rendering one tick behind the sim).
   */
  alpha(now: number, tick: number): number {
    const a = (this.effectiveSimMs(now) * WORLD.SIM_HZ) / 1000 - tick;
    return Math.min(1, Math.max(0, a));
  }
}
