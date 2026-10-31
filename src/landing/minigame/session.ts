/**
 * The hero dash as a state machine around a real core Race: the 100 m against Pip at tier 1, the
 * game's own first race, so physics, the countdown, false starts, the field and Pip's quirks are
 * the game's. DOM-free so it runs under Vitest; the view (view.ts) feeds it time and inputs and
 * draws what it hands back.
 */
import {
  EVENTS,
  Race,
  TUNING,
  type InputSource,
  type RaceEvent,
  type RaceInput,
  type RaceOutcome,
  type RaceState,
} from '../../core/index.ts';
import type { LandingCue } from '../audio/index.ts';
import type { DashEvent } from './index.ts';

export const DASH_EVENT = '100m';
export const DASH_RIVAL = 'pip';

/** Step cues at most this often (RaceScene's STEP_SFX_MIN_MS): mashing gives 10+ steps a second. */
export const STEP_CUE_MIN_MS = 40;

/**
 * ready: nothing started yet (start prompt). live: a race from the walk-in to its results.
 * paused: a live race frozen off screen or in a hidden tab. result: the card is up.
 */
export type DashMode = 'ready' | 'live' | 'paused' | 'result';

export interface SessionOptions {
  readonly onEvent: (e: DashEvent) => void;
  readonly cue: (c: LandingCue) => void;
  /** uint32 seed per race (core newSeed in the page, fixed in tests). */
  readonly seed: () => number;
}

type Slot = 'L' | 'R' | 'jump';

function slotOf(e: RaceInput): Slot {
  return 'side' in e ? e.side : 'jump';
}

export class DashSession {
  readonly #opts: SessionOptions;
  #mode: DashMode = 'ready';
  #race: Race | null = null;
  #outcome: RaceOutcome | null = null;
  #races = 0;
  #lastStepCue = Number.NEGATIVE_INFINITY;
  /** Slots each source holds, so a detached source can be released (input contract "held rule"). */
  readonly #held: Record<InputSource, Set<Slot>> = { k: new Set(), t: new Set() };

  constructor(opts: SessionOptions) {
    this.#opts = opts;
  }

  get mode(): DashMode {
    return this.#mode;
  }

  /** The race on screen (null before the first start). Kept after the result for the run-out. */
  get state(): RaceState | null {
    return this.#race?.state ?? null;
  }

  /** The finished race's outcome while the card is up. */
  get outcome(): RaceOutcome | null {
    return this.#mode === 'result' ? this.#outcome : null;
  }

  /** True while run keys belong to the dash (the view captures them only then). */
  get capturing(): boolean {
    return this.#mode === 'live';
  }

  /**
   * Starts a race (the start prompt or a retry). The first race walks in; a retry waits at the
   * blocks (TUNING.RETRY_INTRO_MS), as the game's RETRY. Ignored while a race is on.
   */
  start(now: number): boolean {
    if (this.#mode === 'live' || this.#mode === 'paused') return false;
    this.#race = new Race({
      event: DASH_EVENT,
      opponent: DASH_RIVAL,
      seed: this.#opts.seed(),
      startT: now,
      ...(this.#races > 0 ? { introMs: TUNING.RETRY_INTRO_MS } : {}),
    });
    this.#races += 1;
    this.#outcome = null;
    this.#held.k.clear();
    this.#held.t.clear();
    this.#lastStepCue = Number.NEGATIVE_INFINITY;
    this.#mode = 'live';
    this.#opts.onEvent({ type: 'start' });
    return true;
  }

  /** A run input from a source. Dropped unless a race is live or paused (paused: held tracking only). */
  input(e: RaceInput): void {
    if (this.#race === null || (this.#mode !== 'live' && this.#mode !== 'paused')) return;
    if (!e.repeat) {
      const held = this.#held[e.source ?? 'k'];
      if (e.kind === 'down') held.add(slotOf(e));
      else held.delete(slotOf(e));
    }
    this.#race.input(e);
  }

  /**
   * Lifts every slot `source` holds at `t`. The view calls it when it detaches the keyboard or drops
   * the pointers, whose own release would never reach the race: a side left held could not step.
   */
  release(source: InputSource, t: number): void {
    const held = this.#held[source];
    for (const slot of [...held]) {
      this.input(
        slot === 'jump'
          ? { kind: 'up', action: 'jump', t, repeat: false, source }
          : { kind: 'up', side: slot, t, repeat: false, source },
      );
    }
    held.clear();
  }

  /**
   * Off screen, hidden tab or window blur. Like the game, a race in its run-out (player crossed) is
   * not paused: its result is already final. Returns whether it paused.
   */
  pause(now: number): boolean {
    if (this.#mode !== 'live' || this.#race === null) return false;
    if (this.#race.state.phase === 'finished') return false;
    this.#race.pause(now);
    this.#mode = 'paused';
    return true;
  }

  /** Explicit resume; the race then holds a 0.5 s GET SET freeze (TUNING.RESUME_FREEZE_MS). */
  resume(now: number): boolean {
    if (this.#mode !== 'paused' || this.#race === null) return false;
    this.#race.resume(now);
    this.#mode = 'live';
    return true;
  }

  /**
   * One frame: advances a live race to `now`, plays cues, emits DashEvents and turns `resultReady`
   * into the result mode. The result keeps advancing so the run-out and celebrations play on.
   */
  advance(now: number): readonly RaceEvent[] {
    const race = this.#race;
    if (race === null || this.#mode === 'paused' || this.#mode === 'ready') return [];
    const events = race.advance(now);
    if (this.#mode !== 'live') return events;
    for (const ev of events) this.#handle(ev, now, race);
    return events;
  }

  #handle(ev: RaceEvent, now: number, race: Race): void {
    const { cue, onEvent } = this.#opts;
    switch (ev.type) {
      case 'beat':
        cue(ev.beat === 'go' ? 'go' : 'countdown');
        break;
      case 'step':
        if (now - this.#lastStepCue >= STEP_CUE_MIN_MS) {
          this.#lastStepCue = now;
          cue('step');
        }
        break;
      case 'falseStart':
        // The second one is followed by 'disqualified' in the same batch.
        cue('falseStart');
        onEvent({ type: 'falseStart' });
        break;
      case 'disqualified':
        onEvent({ type: 'disqualified' });
        break;
      case 'playerFinish':
      case 'dnf': {
        // The outcome is final from the crossing; the fanfare plays there, the card 1.5 s later.
        const o = race.state.outcome;
        cue(o?.result === 'win' ? 'win' : 'lose');
        break;
      }
      case 'resultReady':
        this.#outcome = ev.outcome;
        this.#mode = 'result';
        if (ev.outcome.result !== 'dq') onEvent(finishEvent(ev.outcome));
        break;
      default:
        break;
    }
  }
}

/**
 * The page's finish event for a run to the line, or a DNF (a loss at the event's 30 s cap).
 * `won` is the game's rule: 1st of the six runners. Whether Rio beat Pip is youMs < pipMs.
 */
export function finishEvent(o: RaceOutcome): Extract<DashEvent, { type: 'finish' }> {
  return {
    type: 'finish',
    won: o.result === 'win',
    photo: o.photoFinish,
    youMs: o.ms ?? EVENTS[o.event].dnfMs,
    pipMs: o.oppMs ?? 0,
  };
}
