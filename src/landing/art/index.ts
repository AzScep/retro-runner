/**
 * Game art for the landing page (owner: J3). Renders the game's own palette-indexed pixel maps
 * (src/art/landing.ts) at runtime, so the page never ships a second copy of the art and never loads
 * Phaser. Everything here is pure and cached; PixelSprite (pixelSprite.ts) puts clips on a canvas.
 *
 * Spoiler rule: Zyx exists only as the black locked portrait, and tier 7 (the space stadium and its
 * meet badge) cannot be requested at all. Types reject both, and so does every function at runtime.
 */
import type { CharacterId, EventId, OpponentId } from '../../core/index.ts';
import {
  AIR_SHADOW_SIZES,
  airRaisePx,
  airShadow,
  airShadowIndex,
  blit,
  buildCharacter,
  createMap,
  encodeIndexedPng,
  eventPictogram,
  farLayer,
  fgLayer,
  FRAME_SIZE,
  HURDLE_FRAME,
  hurdleFrameIndex,
  hurdleStanding,
  layerScroll,
  LAYERS,
  lockedPortrait,
  meetBadge,
  mod,
  nearLayer,
  PIVOT_X,
  PIVOT_Y,
  pngDataUrl,
  portrait16,
  portrait48,
  skyLayer,
  standsLayer,
  trackLayer,
  type CharacterArt,
  type IndexMap,
  type LayerName,
} from '../../art/landing.ts';

export type { IndexMap };
export {
  FRAME_SIZE,
  LANE_COUNT,
  LANE_FEET_Y,
  LANE_LINE_Y,
  LANE_OBLIQUE_PX,
  laneOffsetPx,
  PIVOT_X,
  PIVOT_Y,
} from '../../art/landing.ts';
import { type SpriteClip } from './clip.ts';

export { clipFrameAt, type SpriteClip } from './clip.ts';
export { PixelSprite, type PixelSpriteOptions } from './pixelSprite.ts';

/** Characters the page may animate: everyone but Zyx. */
export type LandingCharacterId = Exclude<CharacterId, 'zyx'>;
/** Rivals with a full portrait: everyone but Zyx, who only appears locked. */
export type LandingRivalId = Exclude<OpponentId, 'zyx'>;
/** Meets the page may show; tier 7 is the twist. */
export type LandingTier = 1 | 2 | 3 | 4 | 5 | 6;

export const LANDING_CHARACTERS: readonly LandingCharacterId[] = [
  'rio',
  'pip',
  'jess',
  'marco',
  'kofi',
  'valentina',
  'unit7',
  'sol',
];
/** Rival select order (ladder order, Sol last); Zyx's slot is the locked portrait. */
export const LANDING_RIVALS: readonly LandingRivalId[] = [
  'pip',
  'jess',
  'marco',
  'kofi',
  'valentina',
  'unit7',
  'sol',
];
export const LANDING_TIERS: readonly LandingTier[] = [1, 2, 3, 4, 5, 6];
export const LANDING_EVENTS: readonly EventId[] = ['100m', '110mh', '400m'];

/**
 * Animations as baked by the game (design 5.6, 19.1, 35.1). Every character has the first eight;
 * the rest exist only for some (characterAnims lists them): `hurdle` all but Sol, `tired`, `fall`,
 * `lie`, `getup` Rio, `wave` Pip, `runLook` Marco, `runOc` UNIT-7.
 */
export type CharacterAnim =
  | 'idle'
  | 'walk'
  | 'ready'
  | 'run'
  | 'lean'
  | 'celebrate'
  | 'lose'
  | 'stumble'
  | 'hurdle'
  | 'tired'
  | 'fall'
  | 'lie'
  | 'getup'
  | 'wave'
  | 'runLook'
  | 'runOc';

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

function assertCharacter(id: string): asserts id is LandingCharacterId {
  if (!(LANDING_CHARACTERS as readonly string[]).includes(id)) {
    throw new RangeError(`landing art: no character art for '${id}'`);
  }
}

function assertTier(tier: number): asserts tier is LandingTier {
  if (!(LANDING_TIERS as readonly number[]).includes(tier)) {
    throw new RangeError(`landing art: tier must be 1-6, got ${tier}`);
  }
}

function assertScale(scale: number): void {
  if (!Number.isInteger(scale) || scale < 1) {
    throw new RangeError(`landing art: scale must be a positive integer, got ${scale}`);
  }
}

// ---------------------------------------------------------------------------
// Characters
// ---------------------------------------------------------------------------

const characterCache = new Map<LandingCharacterId, CharacterArt>();
const clipCache = new Map<string, SpriteClip>();

/** One character's frames, built on first use (5-10 ms) and kept for the page's life. */
function characterArt(id: LandingCharacterId): CharacterArt {
  let art = characterCache.get(id);
  if (art === undefined) {
    art = buildCharacter(id);
    characterCache.set(id, art);
  }
  return art;
}

/** Animations `id` has, in bake order. */
export function characterAnims(id: LandingCharacterId): readonly CharacterAnim[] {
  assertCharacter(id);
  return characterArt(id).anims.map((a) => a.name as CharacterAnim);
}

/**
 * 48x48 frames of a game animation with its fps and loop flag, pivot (24, 47). Throws for Zyx and
 * for an animation the character does not have (Sol has no `hurdle`, only Rio has `tired`).
 * `run` plays at a fixed 12 fps here; the game varies it with speed (PixelSprite takes an fps).
 */
export function characterFrames(id: LandingCharacterId, anim: CharacterAnim): SpriteClip {
  assertCharacter(id);
  const key = `${id}.${anim}`;
  let clip = clipCache.get(key);
  if (clip === undefined) {
    const art = characterArt(id);
    const a = art.anims.find((x) => x.name === anim);
    if (a === undefined) throw new RangeError(`landing art: '${id}' has no '${anim}' animation`);
    const byName = new Map(art.frames.map((f) => [f.name, f.map]));
    clip = {
      frames: a.frames.map((name) => byName.get(name) as IndexMap),
      // Arc-driven anims (hurdle) carry a nominal fps; held anims (ready) a 1 fps placeholder.
      fps: a.fps,
      loop: a.repeat === -1,
      w: FRAME_SIZE,
      h: FRAME_SIZE,
      pivotX: PIVOT_X,
      pivotY: PIVOT_Y,
    };
    clipCache.set(key, clip);
  }
  return clip;
}

/**
 * Jump arc, duplicated from core TUNING (JUMP_AIR_MS, JUMP_PEAK_M) so the page bundle stays free of
 * core values (they drag in the roster and its ladder text). Checked by a test.
 */
export const JUMP_ARC = { airMs: 400, peakM: 1.3 } as const;

/** Hurdle loop geometry: the runner holds x while the hurdle passes under at the arc peak. */
export const HURDLE_LOOP = {
  w: 112,
  h: 76,
  /** Runner pivot x and the lane's feet row in the clip. */
  x: 32,
  feetY: 72,
  fps: 12,
  /** Run frames before takeoff, then the air frames, then run frames back to the loop start. */
  runIn: 8,
  runOut: 3,
  /** Px the hurdle moves left per frame. */
  speedPx: 10,
} as const;

/**
 * A self-contained hurdle-jump loop for a mechanics card: `id` runs in place, a standing hurdle slides
 * in from the right and `id` clears it with the game's arc (design 13.2, 19.1: airtime and peak from
 * JUMP_ARC, frame floor(4 * s), raise round(airM * 24)), with the shrinking ground shadow.
 * The hurdle sits behind the runner, as in its own lane. Transparent background, HURDLE_LOOP size.
 */
export function hurdleJumpClip(id: Exclude<LandingCharacterId, 'sol'>): SpriteClip {
  assertCharacter(id);
  if ((id as string) === 'sol') throw new RangeError("landing art: 'sol' never hurdles");
  const key = `${id}.hurdleLoop`;
  const cached = clipCache.get(key);
  if (cached !== undefined) return cached;
  const L = HURDLE_LOOP;
  const run = characterFrames(id, 'run').frames;
  const hurdle = characterFrames(id, 'hurdle').frames;
  const bar = hurdleStanding();
  const airFrames = Math.ceil((JUMP_ARC.airMs * L.fps) / 1000);
  const total = L.runIn + airFrames + L.runOut;
  // The hurdle passes the runner's pivot at mid-air.
  const crossAt = L.runIn + (airFrames - 1) / 2;
  const frames: IndexMap[] = [];
  for (let f = 0; f < total; f++) {
    const m = createMap(L.w, L.h);
    const air = f - L.runIn;
    let body: IndexMap;
    let raise = 0;
    if (air >= 0 && air < airFrames) {
      const s = (air + 0.5) / airFrames;
      body = hurdle[hurdleFrameIndex(s)] as IndexMap;
      raise = airRaisePx(4 * JUMP_ARC.peakM * s * (1 - s));
    } else {
      // Run in from frame 4 so takeoff follows toe-off (run3); landing carries on at run1.
      const i = air < 0 ? 4 + f : air - airFrames + 1;
      body = run[mod(i, 8)] as IndexMap;
    }
    const hx = Math.round(L.x + (crossAt - f) * L.speedPx);
    blit(m, bar, hx - HURDLE_FRAME.pivotX, L.feetY + 1 - HURDLE_FRAME.pivotY);
    const si = airShadowIndex(raise);
    const [sw] = AIR_SHADOW_SIZES[si] ?? AIR_SHADOW_SIZES[0];
    blit(m, airShadow(si), L.x - (sw >> 1), L.feetY - 1);
    blit(m, body, L.x - PIVOT_X, L.feetY + 1 - PIVOT_Y - raise);
    frames.push(m);
  }
  const clip: SpriteClip = {
    frames,
    fps: L.fps,
    loop: true,
    w: L.w,
    h: L.h,
    pivotX: L.x,
    pivotY: L.feetY + 1,
  };
  clipCache.set(key, clip);
  return clip;
}

// ---------------------------------------------------------------------------
// Still images as PNG data URLs
// ---------------------------------------------------------------------------

const urlCache = new Map<string, string>();

function cachedUrl(key: string, map: () => IndexMap, scale: number): string {
  assertScale(scale);
  const k = `${key}@${scale}`;
  let url = urlCache.get(k);
  if (url === undefined) {
    url = pngDataUrl(encodeIndexedPng(map(), { scale }));
    urlCache.set(k, url);
  }
  return url;
}

/** Any pixel map (a clip frame, a stadium layer) as an integer-scaled PNG data URL. Not cached. */
export function pixelUrl(map: IndexMap, scale = 1): string {
  assertScale(scale);
  return pngDataUrl(encodeIndexedPng(map, { scale }));
}

/** Frame `frame` of a clip as a cached PNG data URL, for an <img> that does not animate. */
export function clipStillUrl(id: LandingCharacterId, anim: CharacterAnim, frame = 0, scale = 1): string {
  const clip = characterFrames(id, anim);
  const f = Math.max(0, Math.min(clip.frames.length - 1, Math.round(frame)));
  return cachedUrl(`still.${id}.${anim}.${f}`, () => clip.frames[f] as IndexMap, scale);
}

export type PortraitSize = 16 | 48;

/**
 * Portrait as a PNG data URL (design 5.5): 16x16 or 48x48 at an integer scale. `locked` gives the
 * game's black silhouette (index 1 fill, index 3 rim). Zyx is accepted only locked.
 */
export function portraitUrl(
  id: LandingCharacterId,
  size: PortraitSize,
  locked?: boolean,
  scale?: number,
): string;
export function portraitUrl(id: 'zyx', size: PortraitSize, locked: true, scale?: number): string;
export function portraitUrl(id: CharacterId, size: PortraitSize, locked = false, scale = 1): string {
  if (id === 'zyx') {
    if (locked !== true) throw new RangeError('landing art: Zyx is shown only as the locked silhouette');
  } else {
    assertCharacter(id);
  }
  if (size !== 16 && size !== 48)
    throw new RangeError(`landing art: portrait size must be 16 or 48, got ${size}`);
  return cachedUrl(
    `portrait.${id}.${size}${locked ? '.locked' : ''}`,
    () => portraitMap(id, size, locked),
    scale,
  );
}

/** Same rule as portraitUrl, as a map (tests, canvas drawing). */
export function portraitMap(id: CharacterId, size: PortraitSize, locked: boolean): IndexMap {
  if (id === 'zyx' && !locked)
    throw new RangeError('landing art: Zyx is shown only as the locked silhouette');
  if (id !== 'zyx') assertCharacter(id);
  const m = size === 16 ? portrait16(id) : portrait48(id);
  return locked ? lockedPortrait(m) : m;
}

/** A meet's 16x16 badge (design 31.1), tiers 1-6 only. */
export function meetBadgeUrl(tier: LandingTier, scale = 1): string {
  assertTier(tier);
  return cachedUrl(`meet.${tier}`, () => meetBadge(tier), scale);
}

/** Event pictogram (design 18.2): 32x32 card art or the 16x16 title icon, in colour. */
export function eventIconUrl(event: EventId, size: 16 | 32 = 32, scale = 1): string {
  if (!LANDING_EVENTS.includes(event)) throw new RangeError(`landing art: unknown event '${event}'`);
  if (size !== 16 && size !== 32)
    throw new RangeError(`landing art: event icon size must be 16 or 32, got ${size}`);
  return cachedUrl(`event.${event}.${size}`, () => eventPictogram(event, size), scale);
}

// ---------------------------------------------------------------------------
// Stadiums (design 5.7, 5.8, 26.1)
// ---------------------------------------------------------------------------

/** One parallax layer: a tile repeated across, drawn at screen row `y` of the 180-row view. */
export interface StadiumLayer {
  readonly name: LayerName;
  readonly y: number;
  readonly factor: number;
  /** The tile; `stands` also has `alt`, its second crowd-bob frame (4 fps, 8 fps when excited). */
  readonly map: IndexMap;
  readonly alt?: IndexMap;
}

/** Screen height of the game view the layers stack into. */
export const STADIUM_HEIGHT = 180;
/** The crowd's two bob frames alternate every 250 ms (125 ms when a runner nears the finish). */
export const CROWD_FRAME_MS = 250;

const ORDER: readonly LayerName[] = ['sky', 'far', 'stands', 'near', 'track', 'fg'];
const layerCache = new Map<LandingTier, readonly StadiumLayer[]>();

/**
 * A tier's six layers back to front, with the 100 m signage, for a parallax backdrop: draw each tile
 * repeated from x = -layerOffset(layer, scroll) at its row.
 */
export function stadiumLayers(tier: LandingTier): readonly StadiumLayer[] {
  assertTier(tier);
  let layers = layerCache.get(tier);
  if (layers === undefined) {
    const build: Record<LayerName, () => IndexMap> = {
      sky: () => skyLayer(tier),
      far: () => farLayer(tier),
      stands: () => standsLayer(tier, 0),
      near: () => nearLayer(tier),
      track: () => trackLayer(tier),
      fg: () => fgLayer(tier),
    };
    layers = ORDER.map((name) => ({
      name,
      y: LAYERS[name].y,
      factor: LAYERS[name].factor,
      map: build[name](),
      ...(name === 'stands' ? { alt: standsLayer(tier, 1) } : {}),
    }));
    layerCache.set(tier, layers);
  }
  return layers;
}

/** Whole-pixel offset of a layer for a camera scroll, as the game rounds it (design 5.7). */
export function layerOffset(layer: StadiumLayer, scroll: number): number {
  return layerScroll(Math.round(scroll), layer.factor);
}

export interface StadiumSceneOptions {
  /** Width in game px (default 320, the game view). */
  readonly width?: number;
  /** Camera scroll in game px (default 0). */
  readonly scroll?: number;
  /** Crowd bob frame (default 0). */
  readonly crowdFrame?: 0 | 1;
}

/** A tier's stadium flattened to one opaque `width` x 180 map, as the game shows it at `scroll`. */
export function stadiumScene(tier: LandingTier, opts: StadiumSceneOptions = {}): IndexMap {
  const width = opts.width ?? 320;
  if (!Number.isInteger(width) || width < 1) throw new RangeError(`landing art: bad scene width ${width}`);
  // The game's camera background (index 1) shows through any gap.
  const out = createMap(width, STADIUM_HEIGHT, 1);
  for (const layer of stadiumLayers(tier)) {
    const tile = opts.crowdFrame === 1 && layer.alt ? layer.alt : layer.map;
    const off = layerOffset(layer, opts.scroll ?? 0);
    for (let y = 0; y < tile.h; y++) {
      const oy = layer.y + y;
      if (oy >= STADIUM_HEIGHT) break;
      for (let x = 0; x < width; x++) {
        const v = tile.data[y * tile.w + mod(x + off, tile.w)] as number;
        if (v) out.data[oy * width + x] = v;
      }
    }
  }
  return out;
}

/** stadiumScene as a cached PNG data URL (story ladder vignettes, section backdrops). */
export function stadiumSceneUrl(
  tier: LandingTier,
  opts: StadiumSceneOptions & { readonly scale?: number } = {},
): string {
  assertTier(tier);
  const { scale = 1, ...scene } = opts;
  const k = `stadium.${tier}.${scene.width ?? 320}.${Math.round(scene.scroll ?? 0)}.${scene.crowdFrame ?? 0}`;
  return cachedUrl(k, () => stadiumScene(tier, scene), scale);
}
