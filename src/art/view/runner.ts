/**
 * Pure animation selection for a runner (design 5.6): maps core RunnerState to a texture frame or
 * an animation key. The run cycle is advanced here from runFps so its speed follows the runner.
 */
import type { CharacterId, RunnerState } from '../../core/index.ts';

export interface RunnerViewState {
  /** Run cycle phase in frames (fractional). */
  phase: number;
  /** Local name of the animation currently playing, or null when showing a fixed frame. */
  played: string | null;
}

export type RunnerPick =
  { readonly kind: 'frame'; readonly frame: string } | { readonly kind: 'anim'; readonly anim: string };

export interface PickContext {
  /** Marco is coasting and looks at the camera. */
  readonly coasting?: boolean;
}

export const RUN_FRAMES = 8;
/** Below this speed the run anim shows the "set" frame (design 5.6). */
export const RUN_MIN_SPEED = 0.3;

/**
 * The ready frames are drawn with the pivot under the hips, so a crouched sprinter's hands and head
 * would cover the start line (the pivot sits on it at 0 m). Runners are drawn this many px further
 * back up to the line (walk-in and blocks), and the offset eases out over the first metres after GO.
 */
export const READY_SHIFT_PX = 12;
export const READY_SHIFT_EASE_M = 2;

/** Horizontal draw offset (whole px, <= 0) for a runner at xM metres. */
export function blocksOffsetPx(xM: number): number {
  const k = Math.min(1, Math.max(0, 1 - xM / READY_SHIFT_EASE_M));
  return 0 - Math.round(READY_SHIFT_PX * k);
}

export function pickRunnerView(
  id: CharacterId,
  s: RunnerState,
  dtMs: number,
  vs: RunnerViewState,
  ctx: PickContext = {},
): RunnerPick {
  switch (s.anim) {
    case 'ready1':
      return { kind: 'frame', frame: 'ready0' };
    case 'ready2':
      return { kind: 'frame', frame: 'ready1' };
    case 'run': {
      if (s.vMps < RUN_MIN_SPEED) return { kind: 'frame', frame: 'ready1' };
      if (id === 'pip' && s.effect === 'wave') return { kind: 'anim', anim: 'wave' };
      const fps = Math.max(0, s.runFps);
      vs.phase = (vs.phase + (dtMs / 1000) * fps) % RUN_FRAMES;
      const i = Math.floor(vs.phase) % RUN_FRAMES;
      let prefix = 'run';
      if (id === 'unit7' && s.effect === 'overclock') prefix = 'runOc';
      else if (id === 'marco' && ctx.coasting) prefix = 'runLook';
      return { kind: 'frame', frame: `${prefix}${i}` };
    }
    default:
      return { kind: 'anim', anim: s.anim };
  }
}
