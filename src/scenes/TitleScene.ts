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
import { PAL } from '../ui/hudMath.ts';
import { FONT_MINI } from '../ui/fonts.ts';
import { pinFullscreenButton } from '../ui/fullscreen.ts';
import { titlePrompt } from '../ui/screenText.ts';
import { registerTapTarget } from '../ui/tapTargets.ts';
import { Label } from '../ui/text.ts';
import { sessionStorageOrNull, takeUpdateReload } from '../ui/updateReload.ts';
import { drawPanel, UI_DEPTH } from '../ui/widgets.ts';
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

export const VERSION_LABEL = 'V3.0';

/** Event pictograms row (design 18.8): 16x16 icons 8 px apart, centred, at y 120. */
const ICON_Y = 120;
const ICON_PITCH = 24;
/**
 * Speaker icon at (284, 4), 16 px in from the corner so the desktop fullscreen button (top right,
 * shown while the mouse moves) never covers it; its tap target covers the top-right corner
 * (design 17.5.7).
 */
const SPEAKER = { x: 284, y: 4 } as const;
const SPEAKER_TAP = { x: 264, y: 0, w: 56, h: 24 } as const;
/** The prompt sits on a panel (off the lane line) and shows 750 ms of every second. */
const PROMPT_Y = 104;
const PROMPT_BLINK = { periodMs: 1000, onMs: 750 } as const;

/** S1 Title: logo, event pictograms, PRESS ENTER / TAP TO START, version, mute icon, save warning. */
export class TitleScene extends Phaser.Scene {
  private stadium: Stadium | null = null;
  private prompt!: Label;
  private promptPlate!: Phaser.GameObjects.Graphics;
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
    this.promptPlate = this.add.graphics().setDepth(UI_DEPTH);
    this.prompt = new Label(this, 160, PROMPT_Y, '', { align: 'center', depth: UI_DEPTH + 1 });
    new Label(this, 316, 172, VERSION_LABEL, { font: FONT_MINI, align: 'right', color: PAL.lightGrey });
    // After a new deploy reloaded the page (main.ts), say so once instead of looking like a crash.
    if (takeUpdateReload(sessionStorageOrNull())) {
      new Label(this, 316, 163, 'UPDATED', { font: FONT_MINI, align: 'right', color: PAL.gold });
    }

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
    this.muteKey = new Label(this, SPEAKER.x - 4, 9, 'M', {
      font: FONT_MINI,
      align: 'right',
      color: PAL.lightGrey,
    });
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
      // Why and what to do (private browsing is the usual cause), on a panel off the track.
      drawPanel(this.add.graphics().setDepth(UI_DEPTH), 44, 139, 232, 26);
      new Label(this, 160, 144, 'RECORDS WILL NOT BE SAVED', {
        align: 'center',
        color: PAL.redLight,
        depth: UI_DEPTH + 1,
      });
      new Label(this, 160, 155, 'PRIVATE BROWSING OR BLOCKED STORAGE', {
        font: FONT_MINI,
        align: 'center',
        color: PAL.lightGrey,
        depth: UI_DEPTH + 1,
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
    const w = this.prompt.width + 12;
    this.promptPlate.clear();
    drawPanel(this.promptPlate, Math.round(160 - w / 2), PROMPT_Y - 4, w, 16);
    // The M shortcut label is keyboard copy; on touch the speaker itself is the button.
    this.muteKey.setVisible(!touch);
  }

  private refreshMute(): void {
    this.muteIcon.setTexture(iconKey(settings().muted ? 'speakerOff' : 'speakerOn'));
  }

  update(time: number): void {
    // Steady with reduced flashing; otherwise off for only a quarter of each second.
    const phase = (time - this.t0) % PROMPT_BLINK.periodMs;
    this.prompt.setVisible(settings().reducedFlashing || phase < PROMPT_BLINK.onMs);
  }
}
