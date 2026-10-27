import Phaser from 'phaser';
import { createCharacterSprite, createStadium, paletteColor, type Stadium } from '../art/index.ts';
import { playMusic, playSfx } from '../audio/index.ts';
import { FONT_MINI } from '../ui/fonts.ts';
import { formatLadderTotal, PAL } from '../ui/hudMath.ts';
import { MINI_LINE_HEIGHT } from '../ui/miniFont.ts';
import { Label } from '../ui/text.ts';
import { addPanel, UI_DEPTH } from '../ui/widgets.ts';
import { applyCrt, getApp, goTo, onMenuKeys, SceneKey } from './app.ts';

export const CREDITS: readonly string[] = [
  'RETRO RUNNER',
  '',
  'SEVEN RIVALS. ONE HUNDRED METRES.',
  '',
  'DESIGN',
  'THE GAME DIRECTOR',
  '',
  'CODE',
  'MECHANICS, ART, AUDIO AND UI TEAMS',
  '',
  'FONTS',
  'PRESS START 2P BY CODEMAN38 (OFL 1.1)',
  'RR MINI 5X7 (CC0)',
  '',
  'SOUND',
  'ZZFX AND ZZFXM (MIT)',
  '',
  'ENGINE',
  'PHASER 4',
  '',
  'THANKS FOR PLAYING!',
];

const VIEW = { x: 40, y: 72, w: 240, h: 72 } as const;
const SCROLL_PX_PER_S = 16;

/** S9 Champion: shown once after the first win against Zyx (design 1.3.6). */
export class ChampionScene extends Phaser.Scene {
  private stadium: Stadium | null = null;
  private lines: { label: Label; y0: number }[] = [];
  private t0 = 0;
  private done = false;

  constructor() {
    super(SceneKey.Champion);
  }

  create(): void {
    const app = getApp();
    app.championPending = false;
    this.done = false;
    this.lines = [];
    this.cameras.main.setBackgroundColor(paletteColor(PAL.ink));
    applyCrt(this);
    this.stadium = createStadium(this, 7);
    this.stadium.scrollTo(0);
    createCharacterSprite(this, 'rio', 18, 176).setDepth(50).play('rio.celebrate');
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.stadium?.destroy();
      this.stadium = null;
    });

    new Label(this, 160, 8, 'CHAMPION!', { scale: 4, color: PAL.gold, outline: true, align: 'center' });
    new Label(this, 160, 48, `LADDER TOTAL ${formatLadderTotal(app.records.ladderTotalMs())}`, {
      align: 'center',
      outline: true,
    });
    addPanel(this, VIEW.x - 4, VIEW.y - 4, VIEW.w + 8, VIEW.h + 8);
    CREDITS.forEach((text, i) => {
      const y0 = VIEW.y + VIEW.h + i * (MINI_LINE_HEIGHT + 4);
      this.lines.push({
        label: new Label(this, 160, y0, text, {
          font: FONT_MINI,
          align: 'center',
          color: i === 0 ? PAL.gold : PAL.white,
          depth: UI_DEPTH + 1,
        }),
        y0,
      });
    });
    new Label(this, 160, 170, 'ENTER: SKIP', { font: FONT_MINI, align: 'center', color: PAL.lightGrey });

    this.t0 = this.game.loop.time; // Clock.now is stale until the first preUpdate.
    playMusic('champion');
    onMenuKeys(this, (action) => {
      if (action === 'confirm' || action === 'back') {
        playSfx('menu_select');
        this.finish();
      }
    });
  }

  private finish(): void {
    if (this.done) return;
    this.done = true;
    goTo(this, SceneKey.Ladder);
  }

  update(time: number): void {
    const offset = Math.floor(((time - this.t0) / 1000) * SCROLL_PX_PER_S);
    let anyLeft = false;
    for (const { label, y0 } of this.lines) {
      const y = y0 - offset;
      label.setPosition(160, y);
      const inside = y >= VIEW.y && y + MINI_LINE_HEIGHT <= VIEW.y + VIEW.h;
      label.setVisible(inside);
      if (y + MINI_LINE_HEIGHT > VIEW.y) anyLeft = true;
    }
    if (!anyLeft) this.finish();
  }
}
