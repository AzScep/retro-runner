/**
 * Touch run pads over the race and the keys the dash answers outside the race. Pure: the view hands
 * in pointer ids, positions and key names. Run keys during a race go through core attachKeyboard.
 */
import type { RunKeyEvent, Side } from '../../core/index.ts';

/** The left half of the race area is the LEFT pad, the right half the RIGHT pad. */
export function padSide(x: number, width: number): Side {
  return x < width / 2 ? 'L' : 'R';
}

/**
 * Pointers on the two pads as one touch source (core "held rule"): `down` only for the first pointer
 * on a side, `up` only when its last pointer lifts, so two fingers on one side are one press.
 */
export class TouchPads {
  readonly #pointers = new Map<number, Side>();

  down(pointerId: number, side: Side, t: number): RunKeyEvent | null {
    if (this.#pointers.has(pointerId)) return null;
    const first = !this.holds(side);
    this.#pointers.set(pointerId, side);
    return first ? { kind: 'down', side, t, repeat: false, source: 't' } : null;
  }

  up(pointerId: number, t: number): RunKeyEvent | null {
    const side = this.#pointers.get(pointerId);
    if (side === undefined) return null;
    this.#pointers.delete(pointerId);
    return this.holds(side) ? null : { kind: 'up', side, t, repeat: false, source: 't' };
  }

  holds(side: Side): boolean {
    for (const s of this.#pointers.values()) if (s === side) return true;
    return false;
  }

  /** Forgets every pointer (pause, result); the session releases the race side itself. */
  clear(): void {
    this.#pointers.clear();
  }
}

/** What a page-level key does to the dash, given its mode; null leaves the key to the page. */
export type DashKeyAction = 'start' | 'resume' | 'retry' | 'pause';

export interface DashKeyFacts {
  readonly key: string;
  readonly repeat: boolean;
  /** Ctrl, Alt or Meta held: browser and OS shortcuts are never taken. */
  readonly modified: boolean;
  readonly mode: 'ready' | 'live' | 'paused' | 'result';
  /** The race area is on screen. */
  readonly inView: boolean;
  /**
   * Focus is on the page body or the dash itself, not on another control or a text field, whose
   * own Enter or R must keep working.
   */
  readonly focusFree: boolean;
}

/**
 * Enter starts or resumes, Esc pauses a live race (as in the game), R retries from the card. Only while the dash is on screen and focus is
 * free, so a reader's Enter on a link or R in a field elsewhere is never taken.
 */
export function dashKeyAction(f: DashKeyFacts): DashKeyAction | null {
  if (f.repeat || f.modified || !f.inView || !f.focusFree) return null;
  const k = f.key.toLowerCase();
  if (k === 'enter') {
    if (f.mode === 'ready') return 'start';
    if (f.mode === 'paused') return 'resume';
    return null;
  }
  if (k === 'escape' && f.mode === 'live') return 'pause';
  if (k === 'r' && f.mode === 'result') return 'retry';
  return null;
}
