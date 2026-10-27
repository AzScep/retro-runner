/**
 * Public API of the art layer (owner: ART).
 *
 * All pixels are generated in code from palette-indexed pixel maps and baked to textures at boot
 * (research 3). Views read core state and draw it; they never change game state.
 * Signatures here are the cross-team contract. Spec: docs/design.md section 5 and 6 (icons).
 */
import type Phaser from 'phaser';
import type { CharacterId, EventId, OpponentId, RaceEvent, RaceState } from '../core/index.ts';
import { PALETTE as MASTER, paletteColor as masterColor } from './palette.ts';
import { setCrtImpl } from './phaser/crt.ts';
import { RaceViewImpl } from './phaser/raceView.ts';
import { DEPTH, StadiumView } from './phaser/stadium.ts';
import { KEYS, prepareBake, registerAll } from './phaser/textures.ts';
import type { KeyState } from './sprites/icons.ts';
import type { TouchArtId, TouchArtState } from './sprites/touch.ts';

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
  | 'offscreenArrow'
  | 'keyUp'
  | 'crown'
  | 'newBadge'
  | 'pause'
  | 'rotatePhone'
  | 'staminaArrowUp'
  | 'staminaArrowDown'
  | 'lapOval'
  | 'hurdleTick'
  /** Addition: the 2x3 hurdle tick in index 17 for a knocked hurdle (design 18.4). */
  | 'hurdleTickHit';

/** Texture key of a character portrait. `locked` returns the black silhouette variant. */
export function portraitKey(id: CharacterId, size: PortraitSize, locked?: boolean): string {
  return KEYS.portrait(id, size, locked === true);
}

/**
 * Texture key of a UI icon. 16x16 except: headRival/headPlayer 6x4, offscreenArrow 8x8, crown 8x8,
 * newBadge 24x8, rotatePhone 32x32 (frame 0; play ROTATE_PHONE_ANIM for all 4), staminaArrowUp/Down
 * 5x3, lapOval 32x16 (place dots with lapOvalPoint), hurdleTick/hurdleTickHit 2x3.
 */
export function iconKey(id: IconId): string {
  return KEYS.icon(id);
}

/**
 * Addition: pre-coloured run-key icons for the key prompt (design 6.4), so no runtime tint is
 * needed (tints would leave the palette). 'dim' = index 5, 'bright' = index 8 fill + index 22 border,
 * 'wrong' = index 17 fumble. iconKey('arrowLeft'/'arrowRight') equals the 'bright' variant.
 */
export type { KeyState };
/** 'U' is the up / jump key (design 18.4): same states; iconKey('keyUp') equals its 'bright' variant. */
export function keyIconKey(key: 'L' | 'R' | 'U', state: KeyState): string {
  return KEYS.key(key, state);
}

/** Animation key cycling the 4 rotate-phone frames (0, 30, 60, 90 degrees) on an Image/Sprite. */
export const ROTATE_PHONE_ANIM: string = KEYS.rotatePhoneAnim;

/**
 * Addition: centre (game px, relative to the lapOval icon's top-left) of a 2x2 runner dot at d metres
 * on the 400 m lap (design 18.4): draw the dot at (round(x - 1), round(y - 1)).
 */
export { lapOvalPoint } from './sprites/icons.ts';

/** Texture key of an event pictogram (design 18.2, 18.8): 32x32 cards, 16x16 title; locked = silhouette. */
export function eventIconKey(event: EventId, size: 16 | 32, locked?: boolean): string {
  return KEYS.event(event, size, locked === true);
}

export type { TouchArtId, TouchArtState };
export { rotatePhoneUrl, touchArtUrl } from './touchUrl.ts';

/** Addition: depths used by RaceView / Stadium (world 0-99, UI 100+). */
export const ART_DEPTH = DEPTH;

/**
 * A standalone animated character sprite for menus (ladder card, title, champion screen).
 * Origin is the design pivot (24, 47) so (x, y) is the feet position. Plays `idle` by default.
 * Depth is set to the runner depth (30) so it draws in front of a Stadium; other animations can be
 * played with sprite.play(`${id}.celebrate`) etc. (keys: `${id}.${idle|walk|ready|run|lean|celebrate|lose|stumble}`).
 * v2: `${id}.hurdle` (4 frames, all but Sol; frames are picked from airPhase, not auto-played),
 * `rio.tired` (8), `sol.watch` (2 frames at 6 fps).
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
/** `event` (additive, default '100m') sets the event name on the ad boards and the tier 4 big screen. */
export function createStadium(scene: Phaser.Scene, tier: number, event: EventId = '100m'): Stadium {
  return new StadiumView(scene, tier, event);
}

export interface RaceViewOptions {
  readonly reducedFlashing: boolean;
  readonly screenShake: boolean;
}

/**
 * Everything in world space for one race: stadium layers (the rival's tier in that event), track
 * markings (start line, checkered finish, 10 m boards, or 50 m and split boards in the 400 m), both
 * runners with animations and overlays, per-lane hurdles with knock animations and clip bursts, raised
 * sprites with shrinking ground shadows, the 400 m lap-bell official, sweat drops, dust puffs,
 * flashbulbs, warp/spark FX, and the camera follow rule (design 5.7) over the event's world length
 * (distance + 20 m run-out). HUD is NOT part of this (UI owns it, on a fixed camera).
 *
 * Call update() every rendered frame with the latest state and the events from that frame's advance().
 * Depth: world objects use depths 0-99; UI uses 100+.
 * All objects use scrollFactor 0 and are positioned from the follow rule computed here; the scene's
 * cameras are not moved, so HUD objects need nothing special.
 */
export class RaceView {
  private readonly impl: RaceViewImpl;
  constructor(scene: Phaser.Scene, event: EventId, opponent: OpponentId, opts: RaceViewOptions) {
    this.impl = new RaceViewImpl(scene, event, opponent, opts);
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
