import type { Side } from '../index.ts';
import { TUNING } from '../roster.ts';

export type StepVerdict = 'step' | 'fumble' | 'ignored';

export function opposite(side: Side): Side {
  return side === 'L' ? 'R' : 'L';
}

/**
 * Held counter for one input slot across sources (contract "Input"): each source sends one down for
 * its first press and one up for its last release, so the slot is held while the count is above 0.
 * An up without a down (pressed before the race existed) clamps at 0.
 */
export class Held {
  private n = 0;
  get held(): boolean {
    return this.n > 0;
  }
  down(): void {
    this.n += 1;
  }
  up(): void {
    this.n = Math.max(0, this.n - 1);
  }
}

/**
 * Valid-step rules of design 2.2. Pure: callers feed sides and race-time ms.
 * Held state is per side (ArrowLeft and A are the same side; keyboard and touch are counted
 * together) and is tracked in every phase, so a side held through the countdown or a pause cannot
 * step until every source has released it.
 */
export class StepFilter {
  private readonly held: Record<Side, Held> = { L: new Held(), R: new Held() };
  lastSide: Side | null = null;
  /** Race ms of the last valid step, null before the first one. */
  lastStepMs: number | null = null;

  isHeld(side: Side): boolean {
    return this.held[side].held;
  }

  /** Keyup: only used for the held-side rule. */
  release(side: Side): void {
    this.held[side].up();
  }

  /** Record a keydown outside the running window (intro, countdown, pause, after the finish). */
  noteDown(side: Side): void {
    this.held[side].down();
  }

  /** Classify a keydown during the race. */
  down(side: Side, ms: number, repeat: boolean): StepVerdict {
    // Rule 2: auto-repeat is discarded and changes nothing.
    if (repeat) return 'ignored';
    // Rule 3: a side already held (by the other source) gives nothing, but is counted.
    const wasHeld = this.held[side].held;
    this.held[side].down();
    if (wasHeld) return 'ignored';
    // Same side as the last valid step: fumble, no impulse, no state change.
    if (this.lastSide === side) return 'fumble';
    // Rule 5: 35 ms minimum between valid steps.
    if (this.lastStepMs !== null && ms - this.lastStepMs < TUNING.MIN_STEP_INTERVAL_MS) return 'ignored';
    this.lastSide = side;
    this.lastStepMs = ms;
    return 'step';
  }
}
