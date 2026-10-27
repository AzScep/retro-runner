import Phaser from 'phaser';
import { browserStorage, RecordsStore } from '../core/index.ts';
import { paletteColor, registerArt } from '../art/index.ts';
import { preloadAudio } from '../audio/index.ts';
import { loadPressStart, registerFonts } from '../ui/fonts.ts';
import { PAL } from '../ui/hudMath.ts';
import { Label } from '../ui/text.ts';
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
    await loadPressStart();
    registerFonts(this);
    registerArt(this);
    this.cameras.main.setBackgroundColor(paletteColor(PAL.ink));
    new Label(this, 160, 86, 'LOADING...', { align: 'center' });
    initApp(RecordsStore.load(browserStorage()));
    void preloadAudio().then(() => {
      audioPreloaded = true;
    });
    this.scene.start(SceneKey.Title);
  }
}
