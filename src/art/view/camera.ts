/**
 * Pure view math for the race (design 5.7): world <-> screen, camera follow rule, parallax offsets.
 * Shared by RaceView and tools/art so the mock screenshot matches the game exactly.
 */

/**
 * Duplicated from core WORLD so this module stays importable by plain Node tools. Checked by a test.
 * The race distance is per event (core EVENTS[event].distanceM: 100, 110 or 400 m); the 20 m run-out
 * is the same for every event (design 13.1, 14.3).
 */
export const VIEW = {
  PX_PER_M: 24,
  START_X_PX: 96,
  RUN_OUT_M: 20,
  PLAYER_SCREEN_X: 96,
  WIDTH: 320,
} as const;

/** World x of the finish line for a race distance in metres (100 m: 2496, 400 m: 9696). */
export function finishXPx(distanceM: number): number {
  return VIEW.START_X_PX + distanceM * VIEW.PX_PER_M;
}

export function runOutEndPx(distanceM: number): number {
  return finishXPx(distanceM) + VIEW.RUN_OUT_M * VIEW.PX_PER_M;
}

/** World x in px (float) of a runner at xM metres. */
export function worldX(xM: number): number {
  return VIEW.START_X_PX + xM * VIEW.PX_PER_M;
}

/**
 * Camera scroll (left edge of the view, whole px): the player's pivot sits at screen x = 96;
 * clamped at 0 so the start line is visible at the start, and at the right so the camera stops
 * once the whole run-out is in view (the run-out end sits 64 px inside the right edge).
 */
export function maxScroll(distanceM: number): number {
  return runOutEndPx(distanceM) + 64 - VIEW.WIDTH;
}

export function cameraScroll(playerWorldX: number, distanceM: number): number {
  const s = Math.round(playerWorldX) - VIEW.PLAYER_SCREEN_X;
  return Math.max(0, Math.min(maxScroll(distanceM), s));
}

/** Whole-pixel offset of a parallax layer for a camera scroll. */
export function layerScroll(scroll: number, factor: number): number {
  return Math.round(scroll * factor);
}

/** Positive modulo, for tiling. */
export function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}
