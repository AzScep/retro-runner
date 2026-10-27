/**
 * Public API of the art layer (owner: ART).
 *
 * All pixels are generated in code from palette-indexed pixel maps and baked to textures at boot
 * (research 3). Views read core state and draw it; they never change game state.
 * Signatures here are the cross-team contract. Spec: docs/design.md section 5 and 6 (icons).
 */
import type Phaser from 'phaser';
import type { CharacterId, OpponentId, RaceEvent, RaceState } from '../core/index.ts';
import { PALETTE as MASTER, paletteColor as masterColor } from './palette.ts';
import { setCrtImpl } from './phaser/crt.ts';
import { RaceViewImpl } from './phaser/raceView.ts';
import { DEPTH, StadiumView } from './phaser/stadium.ts';
import { KEYS, prepareBake, registerAll } from './phaser/textures.ts';
import type { KeyState } from './sprites/icons.ts';

export const GAME_WIDTH = 320;
export const GAME_HEIGHT = 180;

/** Master palette as 0xRRGGBB, indexed exactly as design 5.2 (index 0 = transparent). */
export const PALETTE: readonly number[] = MASTER;

/** Palette index -> 0xRRGGBB, for UI tints and Graphics fills. Throws on an invalid index. */
export function paletteColor(index: number): number {
  return masterColor(index);
}

/** Bake every texture and register every animation. Call once from BootScene.create(). Idempotent. */
export function registerArt(scene: Phaser.Scene): void {
  registerAll(scene);
}

/**
 * Addition: starts baking every texture in a background worker. Call as early as possible (before
 * the Phaser game boots) and await it before registerArt(), which then only uploads the result.
 * Never rejects; without a worker (or if it fails) registerArt() bakes inline as before.
 */
export function prepareArt(): Promise<void> {
  return prepareBake();
}

export type PortraitSize = 16 | 48;
export type IconId =
  | 'arrowLeft'
  | 'arrowRight'
  | 'trophy'
  | 'lock'
  | 'speakerOn'
  | 'speakerOff'
  | 'finishFlag'
  | 'headRival'
  | 'headPlayer'
  | 'offscreenArrow';

/** Texture key of a character portrait. `locked` returns the black silhouette variant. */
export function portraitKey(id: CharacterId, size: PortraitSize, locked?: boolean): string {
  return KEYS.portrait(id, size, locked === true);
}

/** Texture key of a UI icon (16x16 except head markers 6x4 and offscreenArrow 8x8). */
export function iconKey(id: IconId): string {
  return KEYS.icon(id);
}

/**
 * Addition: pre-coloured run-key icons for the key prompt (design 6.4), so no runtime tint is
 * needed (tints would leave the palette). 'dim' = index 5, 'bright' = index 8 fill + index 22 border,
 * 'wrong' = index 17 fumble. iconKey('arrowLeft'/'arrowRight') equals the 'bright' variant.
 */
export type { KeyState };
export function keyIconKey(side: 'L' | 'R', state: KeyState): string {
  return KEYS.key(side, state);
}

/** Addition: depths used by RaceView / Stadium (world 0-99, UI 100+). */
export const ART_DEPTH = DEPTH;

/**
 * A standalone animated character sprite for menus (ladder card, title, champion screen).
 * Origin is the design pivot (24, 47) so (x, y) is the feet position. Plays `idle` by default.
 * Depth is set to the runner depth (30) so it draws in front of a Stadium; other animations can be
 * played with sprite.play(`${id}.celebrate`) etc. (keys: `${id}.${idle|walk|ready|run|lean|celebrate|lose|stumble}`).
 */
export function createCharacterSprite(
  scene: Phaser.Scene,
  id: CharacterId,
  x: number,
  y: number,
): Phaser.GameObjects.Sprite {
  return scene.add
    .sprite(Math.round(x), Math.round(y), KEYS.char(id), 'idle0')
    .setOrigin(24 / 48, 47 / 48)
    .setDepth(DEPTH.player)
    .play(KEYS.anim(id, 'idle'));
}

/**
 * Stadium backdrop for a tier (design 5.7, 5.8) usable outside a race (title, ladder, results).
 * scrollTo(px) sets the camera-equivalent scroll; layers apply their parallax factors and round to whole px.
 */
export interface Stadium {
  scrollTo(px: number): void;
  /** Crowd bob speed-up when a runner is near the finish. */
  setExcited(excited: boolean): void;
  destroy(): void;
}
export function createStadium(scene: Phaser.Scene, tier: number): Stadium {
  return new StadiumView(scene, tier);
}

export interface RaceViewOptions {
  readonly reducedFlashing: boolean;
  readonly screenShake: boolean;
}

/**
 * Everything in world space for one race: stadium layers, track markings (start line, checkered finish,
 * 10 m boards), both runners with animations and overlays, dust puffs, flashbulbs, warp/spark FX,
 * and the camera follow rule (design 5.7). HUD is NOT part of this (UI owns it, on a fixed camera).
 *
 * Call update() every rendered frame with the latest state and the events from that frame's advance().
 * Depth: world objects use depths 0-99; UI uses 100+.
 * All objects use scrollFactor 0 and are positioned from the follow rule computed here; the scene's
 * cameras are not moved, so HUD objects need nothing special.
 */
export class RaceView {
  private readonly impl: RaceViewImpl;
  constructor(scene: Phaser.Scene, opponent: OpponentId, opts: RaceViewOptions) {
    this.impl = new RaceViewImpl(scene, opponent, opts);
  }
  update(state: RaceState, events: readonly RaceEvent[]): void {
    this.impl.update(state, events);
  }
  /** Screen-space x of the rival (for the HUD off-screen arrow); may be outside 0-320. */
  rivalScreenX(): number {
    return this.impl.rivalScreenX();
  }
  destroy(): void {
    this.impl.destroy();
  }
}

/** Optional CRT post-effect on a camera (WebGL only; no-op under Canvas). */
export function setCrt(camera: Phaser.Cameras.Scene2D.Camera, on: boolean): void {
  setCrtImpl(camera, on);
}
