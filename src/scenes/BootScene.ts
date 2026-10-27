import Phaser from 'phaser';
import { browserStorage, RecordsStore } from '../core/index.ts';
import { GAME_HEIGHT, GAME_WIDTH, iconKey, paletteColor, prepareArt, registerArt } from '../art/index.ts';
import { preloadAudio } from '../audio/index.ts';
import { FONT_PS, loadPressStart, registerFonts } from '../ui/fonts.ts';
import { PAL } from '../ui/hudMath.ts';
import { Label } from '../ui/text.ts';
import { fillRect } from '../ui/widgets.ts';
import { initApp, SceneKey } from './app.ts';

/** Last boot failure, surfaced through the test hook so integration failures are diagnosable. */
export let bootError: string | null = null;

/** True once the background audio pre-render has settled (test hook diagnostics). */
export let audioPreloaded = false;

/**
 * Boot: fonts, art and records, then Title (design S1). Audio pre-rendering continues in the
 * background: preloadAudio() never rejects, and playMusic() before a track is rendered is safe (it
 * starts once the track is ready), so the Title never waits on it.
 */
export class BootScene extends Phaser.Scene {
  constructor() {
    super(SceneKey.Boot);
  }

  create(): void {
    this.boot().catch((e: unknown) => {
      bootError = e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e);
      throw e;
    });
  }

  private async boot(): Promise<void> {
    await Promise.all([loadPressStart(), prepareArt()]);
    registerFonts(this);
    registerArt(this);
    this.cameras.main.setBackgroundColor(paletteColor(PAL.ink));
    const warm = this.warmShaders();
    new Label(this, 160, 86, 'LOADING...', { align: 'center' });
    initApp(RecordsStore.load(browserStorage()));
    void preloadAudio().then(() => {
      audioPreloaded = true;
    });
    // Title starts once the warm-up frame has rendered (and compiled its shaders).
    this.game.events.once(Phaser.Core.Events.POST_RENDER, () => {
      for (const o of warm) o.destroy();
      this.scene.start(SceneKey.Title);
    });
  }

  /**
   * Phaser 4 links a shader program the first time a batch needs it, and the textured batch
   * shaders are specialised per number of textures in the batch. All art shares one atlas texture
   * and both fonts share another, so the game only ever needs 1 or 2 textures per batch. This
   * draws one batch of each kind (tile sprite, 1 texture, 2 textures, untextured fill) under an
   * opaque cover on the loading frame, so no program is linked mid-game (each link stalled the
   * main thread for 50-450 ms in a race).
   */
  private warmShaders(): Phaser.GameObjects.GameObject[] {
    const icon = iconKey('trophy');
    const sep = (): Phaser.GameObjects.Graphics => {
      const g = this.add.graphics();
      fillRect(g, 0, 0, 1, 1, PAL.ink);
      return g;
    };
    const objs: Phaser.GameObjects.GameObject[] = [
      this.add.tileSprite(0, 0, 16, 16, icon).setOrigin(0, 0),
      sep(),
      this.add.image(0, 0, icon).setOrigin(0, 0),
      sep(),
      this.add.image(0, 0, icon).setOrigin(0, 0),
      this.add.bitmapText(0, 0, FONT_PS, 'A', 8),
    ];
    const cover = this.add.graphics();
    fillRect(cover, 0, 0, GAME_WIDTH, GAME_HEIGHT, PAL.ink);
    objs.push(cover);
    return objs;
  }
}
