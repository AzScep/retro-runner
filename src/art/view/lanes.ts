/**
 * Pure lane math for the 6-lane race (design 26.1-26.3, 26.5), shared by RaceView and tools/art so
 * the mock race frames use the same rows, offsets and draw order as the game.
 */
import { LANE_COUNT, LANE_FEET_Y, laneOffsetPx } from '../stadium/layers.ts';
import { VIEW, worldX } from './camera.ts';
import { blocksOffsetPx } from './runner.ts';

/** Depths of one lane's objects: far lanes lower, so lane 0 (the player) draws last (26.3). */
export interface LaneDepths {
  readonly hurdle: number;
  readonly shadow: number;
  readonly runner: number;
  readonly fx: number;
}

/** Lane 5 starts at 10; each nearer lane is 6 higher; lane 0 is 40-43 (below dust 44, L5 50). */
export function laneDepth(lane: number): LaneDepths {
  const base = 10 + (LANE_COUNT - 1 - lane) * 6;
  return { hurdle: base, shadow: base + 1, runner: base + 2, fx: base + 3 };
}

/** Feet row of a lane. */
export function laneFeetY(lane: number): number {
  return LANE_FEET_Y[Math.max(0, Math.min(LANE_COUNT - 1, lane))] as number;
}

/**
 * Screen x of a runner's pivot: true world x, the blocks shift near the start, and the lane oblique
 * (design 26.2). Simulation and timing never see the oblique.
 */
export function runnerScreenX(lane: number, xM: number, scroll: number): number {
  return Math.round(worldX(xM)) + blocksOffsetPx(xM) + laneOffsetPx(lane) - scroll;
}

/** Hurdles drawn within the view plus this margin are visible (design 26.5). */
export const HURDLE_CULL_PX = 40;

export function hurdleVisible(screenX: number): boolean {
  return screenX > -HURDLE_CULL_PX && screenX < VIEW.WIDTH + HURDLE_CULL_PX;
}
