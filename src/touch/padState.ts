/**
 * Pure pad visuals from the race feed (design 17.4, 6.4, 18.4).
 *
 * Called once per published race frame. Short flashes (held-blocked, fumble) last 4 frames.
 * Priority: fumble > blocked > pressed > the prompt state (expected / ready / idle).
 */
import type { RaceEvent, RaceState } from '../core/index.ts';
import type { Control } from './pointerMap.ts';

export type PadVisual = 'idle' | 'expected' | 'ready' | 'pressed' | 'blocked' | 'fumble';

export const FLASH_FRAMES = 4;
/** Jump pad turns `ready` when the next hurdle is this close (s). */
export const JUMP_READY_S = 1.0;
/** No valid step for this long: both pads pulse (6.4 rule 3). */
export const MASH_IDLE_MS = 500;

/** The race facts the pads need (a structural subset of RaceState). */
export type PadRaceState = Pick<
  RaceState,
  'phase' | 'paused' | 'expectedSide' | 'idleMs' | 'nextHurdleS' | 'event' | 'outcome'
> & { readonly player: Pick<RaceState['player'], 'finishMs'> };

export interface PadFrame {
  /** Race on screen, not paused, player still running: pads shown and zones live. */
  readonly live: boolean;
  /** JUMP pad and zone exist (hurdles). */
  readonly hurdles: boolean;
  readonly pads: Readonly<Record<Control, PadVisual>>;
  /** Fumble shake offset in game px for each pad (0 or +-2). */
  readonly shake: Readonly<Record<Control, number>>;
}

export const HIDDEN_FRAME: PadFrame = {
  live: false,
  hurdles: false,
  pads: { L: 'idle', R: 'idle', jump: 'idle' },
  shake: { L: 0, R: 0, jump: 0 },
};

export class PadStates {
  private readonly blocked: Record<Control, number> = { L: 0, R: 0, jump: 0 };
  private readonly fumble: Record<Control, number> = { L: 0, R: 0, jump: 0 };

  /** A second finger landed on a held control. */
  flashBlocked(control: Control): void {
    this.blocked[control] = FLASH_FRAMES;
  }

  /** Visuals for this frame; pass `consume: false` to re-render without ageing the flashes. */
  frame(
    state: PadRaceState | null,
    events: readonly RaceEvent[],
    held: (c: Control) => number,
    reducedFlashing: boolean,
    consume = true,
  ): PadFrame {
    if (consume) {
      for (const e of events) if (e.type === 'fumble') this.fumble[e.side] = FLASH_FRAMES;
    }
    if (!state || state.paused || state.outcome !== null || state.player.finishMs !== null) {
      if (consume) this.clearFlashes();
      return { ...HIDDEN_FRAME, hurdles: state?.event === '110mh' };
    }
    const running = state.phase === 'running';
    const mash = running && state.idleMs >= MASH_IDLE_MS;
    const pulseOn = Math.floor(state.idleMs / (reducedFlashing ? 500 : 250)) % 2 === 0;
    const base = (side: 'L' | 'R'): PadVisual => {
      if (!running) return 'idle';
      if (mash) return pulseOn ? 'expected' : 'idle';
      if (reducedFlashing || state.expectedSide === null) return 'expected';
      return state.expectedSide === side ? 'expected' : 'idle';
    };
    const ready = state.nextHurdleS !== null && state.nextHurdleS <= JUMP_READY_S;
    const baseOf: Record<Control, PadVisual> = { L: base('L'), R: base('R'), jump: ready ? 'ready' : 'idle' };

    const pads = {} as Record<Control, PadVisual>;
    const shake = {} as Record<Control, number>;
    for (const c of ['L', 'R', 'jump'] as const) {
      const f = this.fumble[c];
      pads[c] =
        f > 0 ? 'fumble' : this.blocked[c] > 0 ? 'blocked' : held(c) > 0 ? 'pressed' : (baseOf[c] ?? 'idle');
      shake[c] = f > 0 ? (f % 2 === 0 ? 2 : -2) : 0;
      if (consume) {
        this.fumble[c] = Math.max(0, f - 1);
        this.blocked[c] = Math.max(0, this.blocked[c] - 1);
      }
    }
    return { live: true, hurdles: state.event === '110mh', pads, shake };
  }

  private clearFlashes(): void {
    for (const c of ['L', 'R', 'jump'] as const) {
      this.fumble[c] = 0;
      this.blocked[c] = 0;
    }
  }
}
