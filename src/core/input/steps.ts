import type { Side } from '../index.ts';
import { TUNING } from '../roster.ts';

export type StepVerdict = 'step' | 'fumble' | 'ignored';

export function opposite(side: Side): Side {
  return side === 'L' ? 'R' : 'L';
}

/**
 * Valid-step rules of design 2.2. Pure: callers feed sides and race-time ms.
 * Held state is per side (ArrowLeft and A are the same side) and is tracked in every phase,
 * so a key held through the countdown or a pause cannot step until released.
 */
export class StepFilter {
  private readonly held: Record<Side, boolean> = { L: false, R: false };
  lastSide: Side | null = null;
  /** Race ms of the last valid step, null before the first one. */
  lastStepMs: number | null = null;

  isHeld(side: Side): boolean {
    return this.held[side];
  }

  /** Keyup: only used for the held-side rule. */
  release(side: Side): void {
    this.held[side] = false;
  }

  /** Record a keydown outside the running window (intro, countdown, pause, after the finish). */
  noteDown(side: Side): void {
    this.held[side] = true;
  }

  /** Classify a keydown during the race. */
  down(side: Side, ms: number, repeat: boolean): StepVerdict {
    // Rule 2: auto-repeat is discarded and changes nothing.
    if (repeat) return 'ignored';
    // Rule 3: a side already held (other key of the same side, or a lost keyup) gives nothing.
    if (this.held[side]) return 'ignored';
    this.held[side] = true;
    // Same side as the last valid step: fumble, no impulse, no state change.
    if (this.lastSide === side) return 'fumble';
    // Rule 5: 35 ms minimum between valid steps.
    if (this.lastStepMs !== null && ms - this.lastStepMs < TUNING.MIN_STEP_INTERVAL_MS) return 'ignored';
    this.lastSide = side;
    this.lastStepMs = ms;
    return 'step';
  }
}
