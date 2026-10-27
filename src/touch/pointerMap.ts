/**
 * Pure pointer-to-race-input state machine (design 17.3, research-mobile 1).
 *
 * Each finger (pointerId) belongs to the control it landed on until it lifts, is cancelled or
 * loses capture; sliding never changes its control. Per control we keep a finger count:
 * - the first finger down on a control emits `down`;
 * - a further finger on an already held control emits nothing and is reported as `blocked`
 *   (held-blocked pad flash), so two fingers of one hand can never drum one side;
 * - `up` is emitted only when the last finger on that control lifts.
 * This matches the cross-source contract: each source emits `down` for its first press on a side
 * and `up` when its last press there lifts.
 *
 * Timestamps come from `event.timeStamp` (performance.now() origin). A stamp in the future or more
 * than a second old (synthetic or oddly stamped events) falls back to `now`, and emitted times
 * never go backwards.
 */
import type { RaceInput } from '../core/index.ts';

export type Control = 'L' | 'R' | 'jump';
export const CONTROLS: readonly Control[] = ['L', 'R', 'jump'];

/** Oldest accepted event stamp relative to `now`, in ms. */
export const MAX_STAMP_AGE_MS = 1000;

export interface DownResult {
  readonly events: readonly RaceInput[];
  /** True when the control was already held by another finger (nothing emitted). */
  readonly blocked: boolean;
}

/** Touch input is tagged `source: 't'` (design 33.1: touch presses never trip). */
function inputFor(control: Control, kind: 'down' | 'up', t: number): RaceInput {
  if (control === 'jump') return { kind, action: 'jump', t, repeat: false, source: 't' };
  return { kind, side: control, t, repeat: false, source: 't' };
}

export class PointerMap {
  private readonly owner = new Map<number, Control>();
  private readonly count: Record<Control, number> = { L: 0, R: 0, jump: 0 };
  private lastT = Number.NEGATIVE_INFINITY;

  /** Guarded, monotonic event time. */
  stamp(t: number, now: number): number {
    const ok = Number.isFinite(t) && t <= now && t >= now - MAX_STAMP_AGE_MS;
    const s = Math.max(ok ? t : now, this.lastT);
    this.lastT = s;
    return s;
  }

  /** A finger landed on `control`. Repeated downs for a tracked pointerId are ignored. */
  down(pointerId: number, control: Control, t: number, now: number): DownResult {
    if (this.owner.has(pointerId)) return { events: [], blocked: false };
    this.owner.set(pointerId, control);
    this.count[control] += 1;
    if (this.count[control] > 1) return { events: [], blocked: true };
    return { events: [inputFor(control, 'down', this.stamp(t, now))], blocked: false };
  }

  /** pointerup, pointercancel or lostpointercapture: the first one wins, the rest are no-ops. */
  release(pointerId: number, t: number, now: number): readonly RaceInput[] {
    const control = this.owner.get(pointerId);
    if (control === undefined) return [];
    this.owner.delete(pointerId);
    this.count[control] -= 1;
    if (this.count[control] > 0) return [];
    return [inputFor(control, 'up', this.stamp(t, now))];
  }

  /** Window blur, hidden tab, portrait: every held control gets an `up`. */
  releaseAll(t: number, now: number): readonly RaceInput[] {
    const out: RaceInput[] = [];
    for (const control of CONTROLS) {
      if (this.count[control] === 0) continue;
      this.count[control] = 0;
      out.push(inputFor(control, 'up', this.stamp(t, now)));
    }
    this.owner.clear();
    return out;
  }

  /** Fingers currently down on `control`. */
  held(control: Control): number {
    return this.count[control];
  }

  /** True while any finger is tracked. */
  get active(): boolean {
    return this.owner.size > 0;
  }

  /** Whether this pointer is tracked (so a captured finger keeps working after the zone hides). */
  tracks(pointerId: number): boolean {
    return this.owner.has(pointerId);
  }
}
