import { DT_MS, DT_S } from '../clock/clock.ts';
import { TUNING, WORLD } from '../roster.ts';

/** Shared crossing rule (design 2.6): interpolated race ms at which x passes the line. */
export function crossingMs(t0Ms: number, xPrev: number, xNow: number): number {
  return Math.round(t0Ms + (DT_MS * (WORLD.RACE_DISTANCE_M - xPrev)) / (xNow - xPrev));
}

export const MAX_X_M = WORLD.RACE_DISTANCE_M + WORLD.RUN_OUT_M;

/** Player mash-to-speed body (design 2.3). */
export class PlayerBody {
  x = 0;
  /** Position at the previous tick, for render interpolation. */
  xPrev = 0;
  v = 0;
  finishMs: number | null = null;
  /** Cleared on DNF: crossing the line afterwards records nothing. */
  finishable = true;

  /** Valid step impulse. */
  impulse(): void {
    this.v = Math.min(this.v + TUNING.STEP_IMPULSE, WORLD.V_MAX);
  }

  /**
   * One 1/120 s step starting at race time `t0Ms`, `idleMs` after the last valid step.
   * Returns true on the tick that crosses 100 m (finishMs is then set).
   */
  step(t0Ms: number, idleMs: number): boolean {
    this.v -= TUNING.K_DRAG * this.v * DT_S;
    if (idleMs > TUNING.IDLE_GRACE_MS) this.v = Math.max(0, this.v - TUNING.IDLE_DECEL * DT_S);
    this.xPrev = this.x;
    this.x += this.v * DT_S;
    if (this.x >= MAX_X_M) {
      this.x = MAX_X_M;
      this.v = 0;
    }
    if (this.finishable && this.finishMs === null && this.x >= WORLD.RACE_DISTANCE_M) {
      this.finishMs = crossingMs(t0Ms, this.xPrev, this.x);
      return true;
    }
    return false;
  }

  clone(): PlayerBody {
    const c = new PlayerBody();
    c.x = this.x;
    c.xPrev = this.xPrev;
    c.v = this.v;
    c.finishMs = this.finishMs;
    c.finishable = this.finishable;
    return c;
  }
}
