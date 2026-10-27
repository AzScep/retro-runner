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
import { buildIcon, ICON_NAMES, keyIcon, type IconName, type KeyState } from '../sprites/icons.ts';
import { lockedPortrait, portrait16, portrait48 } from '../sprites/portraits.ts';
import {
  distanceBoard,
  farLayer,
  fgLayer,
  finishLine,
  groundShadow,
  nearLayer,
  skyLayer,
  standsLayer,
  startLine,
  TIERS,
  trackLayer,
} from '../stadium/layers.ts';

export const KEYS = {
  char: (id: string) => `char.${id}`,
  anim: (id: string, name: string) => `${id}.${name}`,
  fx: 'fx',
  fxAnim: (name: string) => `fx.${name}`,
  portrait: (id: string, size: number, locked: boolean) => `portrait.${id}.${size}${locked ? '.locked' : ''}`,
  icon: (id: string) => `icon.${id}`,
  key: (side: 'L' | 'R', state: KeyState) => `key.${side}.${state}`,
  layer: (tier: number, name: string) => `stadium.${tier}.${name}`,
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
  for (const side of ['L', 'R'] as const) {
    for (const state of ['dim', 'bright', 'wrong'] as const)
      addTexture(scene, KEYS.key(side, state), keyIcon(side, state));
  }

  for (const tier of TIERS) {
    addTexture(scene, KEYS.layer(tier, 'sky'), skyLayer(tier));
    addTexture(scene, KEYS.layer(tier, 'far'), farLayer(tier));
    addTexture(scene, KEYS.layer(tier, 'stands0'), standsLayer(tier, 0));
    addTexture(scene, KEYS.layer(tier, 'stands1'), standsLayer(tier, 1));
    addTexture(scene, KEYS.layer(tier, 'near'), nearLayer(tier));
    addTexture(scene, KEYS.layer(tier, 'track'), trackLayer(tier));
    addTexture(scene, KEYS.layer(tier, 'fg'), fgLayer(tier));
    addTexture(scene, KEYS.layer(tier, 'start'), startLine(tier));
  }
  addTexture(scene, KEYS.finish, finishLine());
  for (let m = 10; m < 100; m += 10) addTexture(scene, KEYS.board(m), distanceBoard(m));
  addTexture(scene, KEYS.shadow, groundShadow());
}
