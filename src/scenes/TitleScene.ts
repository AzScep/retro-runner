import Phaser from 'phaser';
import { createCharacterSprite, createStadium, iconKey, paletteColor, type Stadium } from '../art/index.ts';
import { playMusic, playSfx } from '../audio/index.ts';
import { flashHz, flashOn, PAL } from '../ui/hudMath.ts';
import { FONT_MINI } from '../ui/fonts.ts';
import { Label } from '../ui/text.ts';
import { UI_DEPTH } from '../ui/widgets.ts';
import { applyCrt, getApp, goTo, onMenuKeys, SceneKey, settings, SETTINGS_CHANGED } from './app.ts';

export const VERSION_LABEL = 'V1.0';

/** S1 Title: logo, PRESS ENTER, version, mute icon, one-time save warning. */
export class TitleScene extends Phaser.Scene {
  private stadium: Stadium | null = null;
  private prompt!: Label;
  private muteIcon!: Phaser.GameObjects.Image;
  private t0 = 0;

  constructor() {
    super(SceneKey.Title);
  }

  create(): void {
    const app = getApp();
    this.cameras.main.setBackgroundColor(paletteColor(PAL.ink));
    applyCrt(this);
    this.stadium = createStadium(this, 1);
    this.stadium.scrollTo(0);
    createCharacterSprite(this, 'rio', 96, 152).setDepth(50);

    new Label(this, 160, 20, 'RETRO', { scale: 4, color: PAL.gold, outline: true, align: 'center' });
    new Label(this, 160, 56, 'RUNNER', { scale: 4, color: PAL.gold, outline: true, align: 'center' });
    this.prompt = new Label(this, 160, 104, 'PRESS ENTER', { align: 'center' });
    new Label(this, 316, 172, VERSION_LABEL, { font: FONT_MINI, align: 'right', color: PAL.lightGrey });

    this.muteIcon = this.add.image(300, 4, iconKey('speakerOn')).setOrigin(0, 0).setDepth(UI_DEPTH);
    new Label(this, 296, 9, 'M', { font: FONT_MINI, align: 'right', color: PAL.lightGrey });
    this.refreshMute();
    this.game.events.on(SETTINGS_CHANGED, this.refreshMute, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.game.events.off(SETTINGS_CHANGED, this.refreshMute, this);
      this.stadium?.destroy();
      this.stadium = null;
    });

    if (!app.records.persistent && !app.saveWarningShown) {
      app.saveWarningShown = true;
      new Label(this, 160, 124, 'RECORDS WILL NOT BE SAVED', { align: 'center', color: PAL.redLight });
    }

    this.t0 = this.game.loop.time; // Clock.now is stale until the first preUpdate.
    playMusic('title');
    onMenuKeys(this, (action) => {
      if (action !== 'confirm') return;
      playSfx('menu_select');
      goTo(this, SceneKey.Ladder);
    });
  }

  private refreshMute(): void {
    this.muteIcon.setTexture(iconKey(settings().muted ? 'speakerOff' : 'speakerOn'));
  }

  update(time: number): void {
    const elapsed = time - this.t0;
    this.prompt.setVisible(flashOn(elapsed, flashHz(1, settings().reducedFlashing)));
  }
}
