/**
 * Everything the game draws, baked to one RGBA atlas page plus the texture, frame, animation and
 * anchor tables that describe it (research 3). Pure, no Phaser and no DOM, so it runs in the bake
 * worker (bake.worker.ts) or inline; phaser/textures.ts uploads the result.
 *
 * Every map shares one page so the renderer binds a single texture for all art: Phaser 4 compiles
 * one shader variant per distinct texture count in a batch, and ~120 separate textures meant new
 * variants (50-450 ms stalls) appearing mid-race.
 */
import { packAtlas, writeRGBA } from './bake/atlas.ts';
import { packSheet, type IndexMap, type SheetRect } from './bake/index.ts';
import { buildCharacter, CHARACTER_IDS, type CharFrame } from './chars/index.ts';
import type { Anchors } from './chars/rig.ts';
import type { SpecId } from './chars/specs.ts';
import { buildEffects } from './sprites/effects.ts';
import { buildIcon, ICON_NAMES, keyIcon, type IconName, type KeyState } from './sprites/icons.ts';
import { lockedPortrait, portrait16, portrait48 } from './sprites/portraits.ts';
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
} from './stadium/layers.ts';

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
  atlas: 'art.atlas',
} as const;

/** One texture key: its rect on the page and its named frames (relative to that rect). */
export interface BakedTexture {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly frames: readonly SheetRect[];
}

export interface BakedAnim {
  readonly key: string;
  readonly texture: string;
  readonly frames: readonly string[];
  readonly fps: number;
  readonly repeat: number;
}

export interface BakedArt {
  /** RGBA8, `w` x `h`. */
  readonly page: Uint8Array<ArrayBuffer>;
  readonly w: number;
  readonly h: number;
  readonly textures: readonly BakedTexture[];
  readonly anims: readonly BakedAnim[];
  /** Overlay anchors per `${characterId}/${frame}`. */
  readonly anchors: readonly (readonly [string, Anchors])[];
}

/** The page is 2048 px wide (every WebGL implementation supports it) and as tall as needed. */
const ATLAS_WIDTH = 2048;

export function bakeArt(): BakedArt {
  const maps: { key: string; map: IndexMap; frames: readonly SheetRect[] }[] = [];
  const add = (key: string, map: IndexMap, frames: readonly SheetRect[] = []): void => {
    maps.push({ key, map, frames });
  };
  const anims: BakedAnim[] = [];
  const anchors: [string, Anchors][] = [];

  for (const id of CHARACTER_IDS) {
    const art = buildCharacter(id);
    const key = KEYS.char(id);
    const sheet = packSheet(
      art.frames.map((f: CharFrame) => ({ name: f.name, map: f.map })),
      8,
    );
    add(key, sheet.map, sheet.rects);
    for (const f of art.frames) anchors.push([`${id}/${f.name}`, f.anchors]);
    for (const a of art.anims) {
      anims.push({
        key: KEYS.anim(id, a.name),
        texture: key,
        frames: a.frames,
        fps: a.fps,
        repeat: a.repeat,
      });
    }
    for (const size of [16, 48] as const) {
      const p = size === 16 ? portrait16(id as SpecId) : portrait48(id as SpecId);
      add(KEYS.portrait(id, size, false), p);
      add(KEYS.portrait(id, size, true), lockedPortrait(p));
    }
  }

  const fx = buildEffects();
  const fxFrames = fx.flatMap((d) => d.frames.map((map, i) => ({ name: `${d.name}${i}`, map })));
  const fxSheet = packSheet(fxFrames, 8);
  add(KEYS.fx, fxSheet.map, fxSheet.rects);
  for (const d of fx) {
    const frames = d.frames.map((_, i) => `${d.name}${i}`);
    anims.push({ key: KEYS.fxAnim(d.name), texture: KEYS.fx, frames, fps: d.fps, repeat: d.repeat });
  }

  for (const name of ICON_NAMES) add(KEYS.icon(name), buildIcon(name as IconName));
  for (const side of ['L', 'R'] as const) {
    for (const state of ['dim', 'bright', 'wrong'] as const) add(KEYS.key(side, state), keyIcon(side, state));
  }

  for (const tier of TIERS) {
    add(KEYS.layer(tier, 'sky'), skyLayer(tier));
    add(KEYS.layer(tier, 'far'), farLayer(tier));
    add(KEYS.layer(tier, 'stands0'), standsLayer(tier, 0));
    add(KEYS.layer(tier, 'stands1'), standsLayer(tier, 1));
    add(KEYS.layer(tier, 'near'), nearLayer(tier));
    add(KEYS.layer(tier, 'track'), trackLayer(tier));
    add(KEYS.layer(tier, 'fg'), fgLayer(tier));
    add(KEYS.layer(tier, 'start'), startLine(tier));
  }
  add(KEYS.finish, finishLine());
  for (let m = 10; m < 100; m += 10) add(KEYS.board(m), distanceBoard(m));
  add(KEYS.shadow, groundShadow());

  const layout = packAtlas(
    maps.map((m) => m.map),
    ATLAS_WIDTH,
  );
  const page = new Uint8Array(layout.w * layout.h * 4);
  const textures = maps.map((m, i): BakedTexture => {
    const { x, y } = layout.slots[i]!;
    writeRGBA(page, layout.w, m.map, x, y);
    return { key: m.key, x, y, w: m.map.w, h: m.map.h, frames: m.frames };
  });
  return { page, w: layout.w, h: layout.h, textures, anims, anchors };
}
