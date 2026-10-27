import Phaser from 'phaser';
import { EVENT_IDS } from '../core/index.ts';
import {
  createCharacterSprite,
  createStadium,
  eventIconKey,
  iconKey,
  paletteColor,
  type Stadium,
} from '../art/index.ts';
import { playMusic, playSfx } from '../audio/index.ts';
import { flashHz, flashOn, PAL } from '../ui/hudMath.ts';
import { FONT_MINI } from '../ui/fonts.ts';
import { pinFullscreenButton } from '../ui/fullscreen.ts';
import { titlePrompt } from '../ui/screenText.ts';
import { registerTapTarget } from '../ui/tapTargets.ts';
import { Label } from '../ui/text.ts';
import { UI_DEPTH } from '../ui/widgets.ts';
import {
  applyCrt,
  currentModality,
  getApp,
  goTo,
  onMenuKeys,
  onModalityChange,
  SceneKey,
  settings,
  SETTINGS_CHANGED,
  toggleMute,
} from './app.ts';

export const VERSION_LABEL = 'V2.0';

/** Event pictograms row (design 18.8): 16x16 icons 8 px apart, centred, at y 120. */
const ICON_Y = 120;
const ICON_PITCH = 24;
/** Speaker icon (300, 4); its tap target covers the top-right corner (design 17.5.7). */
const SPEAKER = { x: 300, y: 4 } as const;
const SPEAKER_TAP = { x: 280, y: 0, w: 40, h: 24 } as const;

/** S1 Title: logo, event pictograms, PRESS ENTER / TAP TO START, version, mute icon, save warning. */
export class TitleScene extends Phaser.Scene {
  private stadium: Stadium | null = null;
  private prompt!: Label;
  private muteKey!: Label;
  private muteIcon!: Phaser.GameObjects.Image;
  private t0 = 0;
  private leaving = false;

  constructor() {
    super(SceneKey.Title);
  }

  create(): void {
    const app = getApp();
    this.leaving = false;
    this.cameras.main.setBackgroundColor(paletteColor(PAL.ink));
    applyCrt(this);
    this.stadium = createStadium(this, 1);
    this.stadium.scrollTo(0);
    createCharacterSprite(this, 'rio', 96, 152).setDepth(50);

    new Label(this, 160, 20, 'RETRO', { scale: 4, color: PAL.gold, outline: true, align: 'center' });
    new Label(this, 160, 56, 'RUNNER', { scale: 4, color: PAL.gold, outline: true, align: 'center' });
    this.prompt = new Label(this, 160, 104, '', { align: 'center' });
    new Label(this, 316, 172, VERSION_LABEL, { font: FONT_MINI, align: 'right', color: PAL.lightGrey });

    const left = 160 - ((EVENT_IDS.length - 1) * ICON_PITCH + 16) / 2;
    EVENT_IDS.forEach((e, i) => {
      this.add
        .image(left + i * ICON_PITCH, ICON_Y, eventIconKey(e, 16, !app.records.isEventUnlocked(e)))
        .setOrigin(0, 0)
        .setDepth(UI_DEPTH);
    });

    this.muteIcon = this.add
      .image(SPEAKER.x, SPEAKER.y, iconKey('speakerOn'))
      .setOrigin(0, 0)
      .setDepth(UI_DEPTH);
    this.muteKey = new Label(this, 296, 9, 'M', { font: FONT_MINI, align: 'right', color: PAL.lightGrey });
    this.refreshMute();
    this.refreshModality();
    this.game.events.on(SETTINGS_CHANGED, this.refreshMute, this);
    onModalityChange(this, () => this.refreshModality());
    // iPad shows the fullscreen button on Title and Options (design 17.6).
    pinFullscreenButton(true);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => pinFullscreenButton(false));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(SETTINGS_CHANGED, this.refreshMute, this);
      this.stadium?.destroy();
      this.stadium = null;
    });

    if (!app.records.persistent && !app.saveWarningShown) {
      app.saveWarningShown = true;
      new Label(this, 160, 142, 'RECORDS WILL NOT BE SAVED', {
        align: 'center',
        color: PAL.redLight,
        outline: true,
      });
    }

    // Touch (17.5.7, 17.6): the speaker toggles mute, a tap anywhere else starts. The two start
    // rectangles cover the screen around the speaker's corner so no targets overlap.
    registerTapTarget(this, SPEAKER_TAP, () => toggleMute(this.game));
    registerTapTarget(this, { x: 0, y: 0, w: SPEAKER_TAP.x, h: 180 }, () => this.start());
    registerTapTarget(this, { x: SPEAKER_TAP.x, y: SPEAKER_TAP.h, w: 40, h: 180 - SPEAKER_TAP.h }, () =>
      this.start(),
    );

    this.t0 = this.game.loop.time; // Clock.now is stale until the first preUpdate.
    playMusic('title');
    onMenuKeys(this, (action) => {
      if (action === 'confirm') this.start();
    });
  }

  private start(): void {
    if (this.leaving) return;
    this.leaving = true;
    playSfx('menu_select');
    goTo(this, SceneKey.Events);
  }

  private refreshModality(): void {
    const touch = currentModality().modality === 'touch';
    this.prompt.setText(titlePrompt(currentModality().modality));
    // The M shortcut label is keyboard copy; on touch the speaker itself is the button.
    this.muteKey.setVisible(!touch);
  }

  private refreshMute(): void {
    this.muteIcon.setTexture(iconKey(settings().muted ? 'speakerOff' : 'speakerOn'));
  }

  update(time: number): void {
    const elapsed = time - this.t0;
    this.prompt.setVisible(flashOn(elapsed, flashHz(1, settings().reducedFlashing)));
  }
}
