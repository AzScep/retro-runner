/**
 * Pure view math for the race (design 5.7): world <-> screen, camera follow rule, parallax offsets.
 * Shared by RaceView and tools/art so the mock screenshot matches the game exactly.
 */

/** Duplicated from core WORLD so this module stays importable by plain Node tools. Checked by a test. */
export const VIEW = {
  PX_PER_M: 24,
  START_X_PX: 96,
  RACE_DISTANCE_M: 100,
  RUN_OUT_M: 20,
  PLAYER_SCREEN_X: 96,
  WIDTH: 320,
} as const;

export const FINISH_X_PX = VIEW.START_X_PX + VIEW.RACE_DISTANCE_M * VIEW.PX_PER_M;
export const RUN_OUT_END_PX = FINISH_X_PX + VIEW.RUN_OUT_M * VIEW.PX_PER_M;

/** World x in px (float) of a runner at xM metres. */
export function worldX(xM: number): number {
  return VIEW.START_X_PX + xM * VIEW.PX_PER_M;
}

/**
 * Camera scroll (left edge of the view, whole px): the player's pivot sits at screen x = 96;
 * clamped at 0 so the start line is visible at the start, and at the right so the camera stops
 * once the whole run-out is in view (the run-out end sits 64 px inside the right edge).
 */
export const MAX_SCROLL = RUN_OUT_END_PX + 64 - VIEW.WIDTH;

export function cameraScroll(playerWorldX: number): number {
  const s = Math.round(playerWorldX) - VIEW.PLAYER_SCREEN_X;
  return Math.max(0, Math.min(MAX_SCROLL, s));
}

/** Whole-pixel offset of a parallax layer for a camera scroll. */
export function layerScroll(scroll: number, factor: number): number {
  return Math.round(scroll * factor);
}

/** Positive modulo, for tiling. */
export function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}
