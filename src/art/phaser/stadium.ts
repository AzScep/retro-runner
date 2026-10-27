/**
 * Stadium backdrop (design 5.7, 5.8): six parallax layers as screen-fixed TileSprites whose tile
 * offsets are rounded to whole pixels, so every layer moves in whole-pixel steps.
 */
import type Phaser from 'phaser';
import { LAYERS, type LayerName, type SignEvent } from '../stadium/layers.ts';
import { layerScroll } from '../view/camera.ts';
import { KEYS } from './textures.ts';

/** Depths of world objects (UI uses 100+). */
export const DEPTH = {
  sky: 0,
  far: 1,
  stands: 2,
  flash: 3,
  near: 4,
  track: 5,
  markings: 6,
  shadow: 10,
  /** Rival-lane hurdles: behind the rival and everything in the player lane (design 19.2). */
  rivalHurdle: 15,
  rival: 20,
  rivalFx: 21,
  /** Player-lane hurdles: in front of the rival lane, behind the player. */
  playerHurdle: 25,
  player: 30,
  playerFx: 31,
  dust: 40,
  fg: 50,
} as const;

const ORDER: readonly LayerName[] = ['sky', 'far', 'stands', 'near', 'track', 'fg'];

export class StadiumView {
  private readonly scene: Phaser.Scene;
  private readonly tier: number;
  private readonly layers = new Map<LayerName, Phaser.GameObjects.TileSprite>();
  /** Second crowd frame, toggled by visibility (avoids resizing on texture swaps). */
  private readonly stands1: Phaser.GameObjects.TileSprite;
  private excited = false;
  private standFrame = 0;
  private readonly onUpdate: (time: number) => void;

  constructor(scene: Phaser.Scene, tier: number, event: SignEvent = '100m') {
    this.scene = scene;
    this.tier = Math.min(7, Math.max(1, Math.round(tier)));
    for (const name of ORDER) {
      const def = LAYERS[name];
      const tex =
        name === 'far' || name === 'near'
          ? KEYS.signLayer(this.tier, name, event)
          : KEYS.layer(this.tier, name === 'stands' ? 'stands0' : name);
      const ts = scene.add
        .tileSprite(0, def.y, 320, def.h, tex)
        .setOrigin(0, 0)
        .setScrollFactor(0)
        .setDepth(DEPTH[name]);
      this.layers.set(name, ts);
    }
    const st = LAYERS.stands;
    this.stands1 = scene.add
      .tileSprite(0, st.y, 320, st.h, KEYS.layer(this.tier, 'stands1'))
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH.stands)
      .setVisible(false);
    this.onUpdate = (time: number) => {
      // Crowd bob: 2 frames at 4 fps, 8 fps when excited (design 5.7).
      const f = Math.floor(time / (this.excited ? 125 : 250)) % 2;
      if (f !== this.standFrame) {
        this.standFrame = f;
        this.stands1.setVisible(f === 1);
        this.layers.get('stands')?.setVisible(f === 0);
      }
    };
    scene.events.on('update', this.onUpdate);
    this.scrollTo(0);
  }

  scrollTo(px: number): void {
    const s = Math.round(px);
    for (const [name, ts] of this.layers) ts.tilePositionX = layerScroll(s, LAYERS[name].factor);
    this.stands1.tilePositionX = layerScroll(s, LAYERS.stands.factor);
  }

  setExcited(excited: boolean): void {
    this.excited = excited;
  }

  destroy(): void {
    this.scene.events.off('update', this.onUpdate);
    for (const ts of this.layers.values()) ts.destroy();
    this.stands1.destroy();
    this.layers.clear();
  }
}
