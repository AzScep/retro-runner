/**
 * Phaser-free art for the /welcome/ landing page (src/landing/art). Re-exports the pure pixel maps
 * and helpers the page renders from, so the page draws the game's own art instead of a copy of it.
 * Nothing here filters spoilers (Zyx, tier 7): src/landing/art is the page's only entry and does.
 */
export { blit, createMap, toRGBA, type IndexMap } from './bake/index.ts';
export { encodeIndexedPng, pngDataUrl } from './png.ts';
export { buildCharacter, FRAME_SIZE, PIVOT_X, PIVOT_Y, type CharacterArt } from './chars/index.ts';
export { lockedPortrait, portrait16, portrait48 } from './sprites/portraits.ts';
export { meetBadge } from './sprites/meets.ts';
export { eventPictogram } from './sprites/events.ts';
export {
  farLayer,
  fgLayer,
  LANE_COUNT,
  LANE_FEET_Y,
  LANE_LINE_Y,
  LANE_OBLIQUE_PX,
  LAYERS,
  laneOffsetPx,
  nearLayer,
  skyLayer,
  standsLayer,
  trackLayer,
  type LayerName,
} from './stadium/layers.ts';
export {
  AIR_SHADOW_SIZES,
  airShadow,
  airShadowIndex,
  HURDLE_FRAME,
  hurdleStanding,
} from './stadium/props.ts';
export { airRaisePx, hurdleFrameIndex } from './view/runner.ts';
export { layerScroll, mod } from './view/camera.ts';
