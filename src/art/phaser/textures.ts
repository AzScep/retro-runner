/**
 * Phaser glue: bakes the pure index maps into textures and registers animations (research 3).
 * Uses CanvasTextures so it works under both WebGL and Canvas renderers.
 */
import type Phaser from 'phaser';
import { packSheet, toRGBA, type IndexMap, type SheetRect } from '../bake/index.ts';
import { buildCharacter, CHARACTER_IDS, type CharFrame } from '../chars/index.ts';
import type { Anchors } from '../chars/rig.ts';
import type { SpecId } from '../chars/specs.ts';
import { buildEffects } from '../sprites/effects.ts';
import { eventPictogram, PICTOGRAM_EVENTS } from '../sprites/events.ts';
import {
  buildIcon,
  ICON_NAMES,
  keyIcon,
  rotatePhone,
  type IconName,
  type KeyState,
} from '../sprites/icons.ts';
import { lockedPortrait, portrait16, portrait48 } from '../sprites/portraits.ts';
import {
  distanceBoard,
  farLayer,
  fgLayer,
  finishLine,
  groundShadow,
  nearLayer,
  SIGN_EVENTS,
  skyLayer,
  standsLayer,
  startLine,
  TIERS,
  trackLayer,
} from '../stadium/layers.ts';
import {
  AIR_SHADOW_SIZES,
  airShadow,
  bellOfficial,
  board50,
  HURDLE_KNOCK_FPS,
  hurdleKnockFrames,
  hurdleStanding,
  splitBoard,
} from '../stadium/props.ts';

/** 400 m small boards (design 14.3): every 50 m except the large split boards at 100/200/300. */
export const BOARD50_M = [50, 150, 250, 350] as const;
export const SPLIT_BOARD_M = [100, 200, 300] as const;

export const KEYS = {
  char: (id: string) => `char.${id}`,
  anim: (id: string, name: string) => `${id}.${name}`,
  fx: 'fx',
  fxAnim: (name: string) => `fx.${name}`,
  portrait: (id: string, size: number, locked: boolean) => `portrait.${id}.${size}${locked ? '.locked' : ''}`,
  icon: (id: string) => `icon.${id}`,
  key: (side: 'L' | 'R' | 'U', state: KeyState) => `key.${side}.${state}`,
  /** Rotate-phone frame textures (frame 0 is `icon.rotatePhone`) and their 4-frame animation. */
  rotatePhoneFrame: (i: number) => (i === 0 ? 'icon.rotatePhone' : `icon.rotatePhone.${i}`),
  rotatePhoneAnim: 'icon.rotatePhone',
  event: (event: string, size: number, locked: boolean) => `event.${event}.${size}${locked ? '.locked' : ''}`,
  hurdle: 'prop.hurdle',
  hurdleKnockAnim: 'prop.hurdle.knock',
  bell: 'prop.bell',
  bellAnim: 'prop.bell.ring',
  board50: (m: number) => `stadium.board50.${m}`,
  split: (m: number) => `stadium.split.${m}`,
  airShadow: (i: number) => (i === 0 ? 'stadium.shadow' : `stadium.shadow.${i}`),
  layer: (tier: number, name: string) => `stadium.${tier}.${name}`,
  /** Event-specific signage layers ('far', 'near'); the 100 m uses the plain layer key. */
  signLayer: (tier: number, name: 'far' | 'near', event: string) =>
    event === '100m' ? `stadium.${tier}.${name}` : `stadium.${tier}.${name}.${event}`,
  finish: 'stadium.finish',
  board: (m: number) => `stadium.board.${m}`,
  shadow: 'stadium.shadow',
} as const;

const anchors = new Map<string, Anchors>();

/** Overlay anchors (frame px) for a character frame, e.g. the mouth for Jess's gum bubble. */
export function frameAnchors(id: string, frame: string): Anchors | undefined {
  return anchors.get(`${id}/${frame}`);
}

function addTexture(scene: Phaser.Scene, key: string, map: IndexMap, rects: readonly SheetRect[] = []): void {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, map.w, map.h);
  if (!tex) throw new Error(`art: could not create texture ${key}`);
  const data = new Uint8ClampedArray(map.w * map.h * 4);
  data.set(toRGBA(map));
  const img = new ImageData(data, map.w, map.h);
  tex.putData(img, 0, 0);
  for (const r of rects) tex.add(r.name, 0, r.x, r.y, r.w, r.h);
  tex.refresh();
}

function addAnim(
  scene: Phaser.Scene,
  key: string,
  texture: string,
  frames: readonly string[],
  fps: number,
  repeat: number,
): void {
  if (scene.anims.exists(key)) return;
  scene.anims.create({
    key,
    frames: frames.map((frame) => ({ key: texture, frame })),
    frameRate: fps,
    repeat,
  });
}

export function registerAll(scene: Phaser.Scene): void {
  // Idempotent per game: the shadow texture is baked last.
  if (scene.textures.exists(KEYS.shadow)) return;

  for (const id of CHARACTER_IDS) {
    const art = buildCharacter(id);
    const key = KEYS.char(id);
    const sheet = packSheet(
      art.frames.map((f: CharFrame) => ({ name: f.name, map: f.map })),
      8,
    );
    addTexture(scene, key, sheet.map, sheet.rects);
    for (const f of art.frames) anchors.set(`${id}/${f.name}`, f.anchors);
    for (const a of art.anims) addAnim(scene, KEYS.anim(id, a.name), key, a.frames, a.fps, a.repeat);

    for (const size of [16, 48] as const) {
      const p = size === 16 ? portrait16(id as SpecId) : portrait48(id as SpecId);
      addTexture(scene, KEYS.portrait(id, size, false), p);
      addTexture(scene, KEYS.portrait(id, size, true), lockedPortrait(p));
    }
  }

  const fx = buildEffects();
  const fxFrames = fx.flatMap((d) => d.frames.map((map, i) => ({ name: `${d.name}${i}`, map })));
  const fxSheet = packSheet(fxFrames, 8);
  addTexture(scene, KEYS.fx, fxSheet.map, fxSheet.rects);
  for (const d of fx) {
    addAnim(
      scene,
      KEYS.fxAnim(d.name),
      KEYS.fx,
      d.frames.map((_, i) => `${d.name}${i}`),
      d.fps,
      d.repeat,
    );
  }

  for (const name of ICON_NAMES) addTexture(scene, KEYS.icon(name), buildIcon(name as IconName));
  for (let i = 1; i < 4; i++) addTexture(scene, KEYS.rotatePhoneFrame(i), rotatePhone(i));
  if (!scene.anims.exists(KEYS.rotatePhoneAnim)) {
    scene.anims.create({
      key: KEYS.rotatePhoneAnim,
      frames: [0, 1, 2, 3].map((i) => ({ key: KEYS.rotatePhoneFrame(i) })),
      frameRate: 4,
      repeat: -1,
      repeatDelay: 600,
    });
  }
  for (const event of PICTOGRAM_EVENTS) {
    for (const size of [16, 32] as const) {
      for (const locked of [false, true])
        addTexture(scene, KEYS.event(event, size, locked), eventPictogram(event, size, locked));
    }
  }
  for (const side of ['L', 'R', 'U'] as const) {
    for (const state of ['dim', 'bright', 'wrong'] as const)
      addTexture(scene, KEYS.key(side, state), keyIcon(side, state));
  }

  for (const tier of TIERS) {
    addTexture(scene, KEYS.layer(tier, 'sky'), skyLayer(tier));
    for (const ev of SIGN_EVENTS) {
      addTexture(scene, KEYS.signLayer(tier, 'far', ev), farLayer(tier, ev));
      addTexture(scene, KEYS.signLayer(tier, 'near', ev), nearLayer(tier, ev));
    }
    addTexture(scene, KEYS.layer(tier, 'stands0'), standsLayer(tier, 0));
    addTexture(scene, KEYS.layer(tier, 'stands1'), standsLayer(tier, 1));
    addTexture(scene, KEYS.layer(tier, 'track'), trackLayer(tier));
    addTexture(scene, KEYS.layer(tier, 'fg'), fgLayer(tier));
    addTexture(scene, KEYS.layer(tier, 'start'), startLine(tier));
  }
  addTexture(scene, KEYS.finish, finishLine());
  for (let m = 10; m <= 100; m += 10) addTexture(scene, KEYS.board(m), distanceBoard(m));
  for (const m of BOARD50_M) addTexture(scene, KEYS.board50(m), board50(m));
  for (const m of SPLIT_BOARD_M) addTexture(scene, KEYS.split(m), splitBoard(m));

  // Hurdle: frame 'stand' plus 'knock0'..'knock3' (the last one lying), one 40x28 cell each.
  const hurdle = packSheet(
    [
      { name: 'stand', map: hurdleStanding() },
      ...hurdleKnockFrames().map((map, i) => ({ name: `knock${i}`, map })),
    ],
    5,
  );
  addTexture(scene, KEYS.hurdle, hurdle.map, hurdle.rects);
  addAnim(
    scene,
    KEYS.hurdleKnockAnim,
    KEYS.hurdle,
    ['knock0', 'knock1', 'knock2', 'knock3'],
    HURDLE_KNOCK_FPS,
    0,
  );
  const bell = packSheet(
    [
      { name: 'f0', map: bellOfficial(0) },
      { name: 'f1', map: bellOfficial(1) },
    ],
    2,
  );
  addTexture(scene, KEYS.bell, bell.map, bell.rects);
  addAnim(scene, KEYS.bellAnim, KEYS.bell, ['f1', 'f0'], 6, -1);
  for (let i = 1; i < AIR_SHADOW_SIZES.length; i++) addTexture(scene, KEYS.airShadow(i), airShadow(i));
  addTexture(scene, KEYS.shadow, groundShadow());
}
