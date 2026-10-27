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
  /** Ms the current watch-glance overlay has played (Sol), for its 6 fps upper-body pose. */
  watchMs?: number;
}

/** Sol's watch overlay: 2 upper-body poses at 6 fps (design 15.5). Mirrors poses.ts WATCH_FPS. */
const WATCH_FPS = 6;

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

/** Hurdle frame for an arc phase s in [0, 1]: floor(4 s), clamped to 0-3 (design 19.1). */
export function hurdleFrameIndex(airPhase: number): number {
  return Math.max(0, Math.min(3, Math.floor(4 * airPhase)));
}

/** Px the sprite is raised for a feet height in metres (design 13.2: round(airM * 24)). */
export function airRaisePx(airM: number): number {
  return Math.max(0, Math.round(airM * 24));
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
    case 'tired':
    case 'run': {
      if (s.vMps < RUN_MIN_SPEED) return { kind: 'frame', frame: 'ready1' };
      if (id === 'pip' && s.effect === 'wave') return { kind: 'anim', anim: 'wave' };
      const fps = Math.max(0, s.runFps);
      vs.phase = (vs.phase + (dtMs / 1000) * fps) % RUN_FRAMES;
      const i = Math.floor(vs.phase) % RUN_FRAMES;
      let prefix = 'run';
      const watching = id === 'sol' && s.effect === 'watch';
      vs.watchMs = watching ? (vs.watchMs ?? 0) + dtMs : 0;
      // Only Rio has the tired cycle (design 19.1); anyone else falls back to the run.
      if (s.anim === 'tired' && id === 'rio') prefix = 'tired';
      else if (id === 'unit7' && s.effect === 'overclock') prefix = 'runOc';
      else if (id === 'marco' && ctx.coasting) prefix = 'runLook';
      // Sol's watch glance overlays the upper body; the legs keep the run cycle frame i.
      else if (watching) prefix = `watch${Math.floor(((vs.watchMs ?? 0) / 1000) * WATCH_FPS) % 2}_`;
      return { kind: 'frame', frame: `${prefix}${i}` };
    }
    case 'hurdle': {
      // Frame from the arc phase (design 13.2, 19.1); Sol has no hurdle frames and never hurdles.
      if (s.airPhase === null || id === 'sol') return { kind: 'frame', frame: 'run3' };
      return { kind: 'frame', frame: `hurdle${hurdleFrameIndex(s.airPhase)}` };
    }
    default:
      return { kind: 'anim', anim: s.anim };
  }
}

/**
 * v3: animation selection for a field runner (design 35.1). Field runners have walk, ready, run,
 * lean, hurdle, stumble (hurdle HIT), celebrate and lose; no idle, no tired cycle, no overlays.
 * Anim names are local (`run`); RaceView prefixes the body and variant.
 */
export function pickFieldView(s: RunnerState, dtMs: number, vs: RunnerViewState): RunnerPick {
  switch (s.anim) {
    case 'ready1':
      return { kind: 'frame', frame: 'ready0' };
    case 'ready2':
      return { kind: 'frame', frame: 'ready1' };
    case 'idle':
      return { kind: 'frame', frame: 'walk1' };
    case 'tired':
    case 'run': {
      if (s.vMps < RUN_MIN_SPEED) return { kind: 'frame', frame: 'ready1' };
      vs.phase = (vs.phase + (dtMs / 1000) * Math.max(0, s.runFps)) % RUN_FRAMES;
      return { kind: 'frame', frame: `run${Math.floor(vs.phase) % RUN_FRAMES}` };
    }
    case 'hurdle':
      if (s.airPhase === null) return { kind: 'frame', frame: 'run3' };
      return { kind: 'frame', frame: `hurdle${hurdleFrameIndex(s.airPhase)}` };
    case 'fall':
    case 'lie':
    case 'getup':
      return { kind: 'anim', anim: 'stumble' };
    default:
      return { kind: 'anim', anim: s.anim };
  }
}
