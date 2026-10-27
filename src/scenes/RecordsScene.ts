import Phaser from 'phaser';
import { formatTime, OPPONENT_IDS, OPPONENTS } from '../core/index.ts';
import { historyCell } from '../ui/screenText.ts';
import { iconKey, paletteColor, portraitKey } from '../art/index.ts';
import { playMusic, playSfx } from '../audio/index.ts';
import { FONT_MINI } from '../ui/fonts.ts';
import { formatLadderTotal, PAL } from '../ui/hudMath.ts';
import { Label } from '../ui/text.ts';
import { drawPanel, fillRect, UI_DEPTH } from '../ui/widgets.ts';
import { applyCrt, getApp, goTo, onMenuKeys, SceneKey } from './app.ts';

const PANEL = { x: 2, y: 12, w: 316, h: 130 } as const;
const HEAD_Y = 16;
const ROW_Y = 26;
const ROW_H = 16;
/**
 * Column x positions. Name and icons are left edges; the time columns are centres, so 'DQ', 'DNF',
 * '--.--' and '12.34' all sit centred under their header. Widest content: VALENTINA (52 px) ends at
 * 80, the trophy spans 84-100, a mini-font time is 26 px, TARGET is 35 px.
 */
const COL = { portrait: 8, name: 28, trophy: 84, pb: 124, target: 166, last: [214, 252, 290] } as const;
const LAST_HEAD = COL.last[1];

/** S6 Records: per-rival PB table, last results and ladder total (design 4.5). */
export class RecordsScene extends Phaser.Scene {
  private highlight!: Phaser.GameObjects.Graphics;
  private row = 0;

  constructor() {
    super(SceneKey.Records);
  }

  create(): void {
    const rec = getApp().records;
    this.cameras.main.setBackgroundColor(paletteColor(PAL.ink));
    applyCrt(this);
    this.row = 0;
    const bg = this.add.graphics().setDepth(UI_DEPTH);
    drawPanel(bg, PANEL.x, PANEL.y, PANEL.w, PANEL.h);
    this.highlight = this.add.graphics().setDepth(UI_DEPTH + 1);

    new Label(this, 160, 2, 'RECORDS', { align: 'center', color: PAL.gold });
    const head = { font: FONT_MINI, color: PAL.lightGrey } as const;
    const headCentre = { ...head, align: 'center' } as const;
    new Label(this, COL.name, HEAD_Y, 'RIVAL', head);
    new Label(this, COL.pb, HEAD_Y, 'PB', headCentre);
    new Label(this, COL.target, HEAD_Y, 'TARGET', headCentre);
    new Label(this, LAST_HEAD, HEAD_Y, 'LAST 3', headCentre);

    OPPONENT_IDS.forEach((id, i) => {
      const y = ROW_Y + i * ROW_H;
      const info = OPPONENTS[id];
      const unlocked = rec.isUnlocked(id);
      const cell = { font: FONT_MINI, depth: UI_DEPTH + 2 } as const;
      this.add
        .image(COL.portrait, y, portraitKey(id, 16, !unlocked))
        .setOrigin(0, 0)
        .setDepth(UI_DEPTH + 2);
      new Label(this, COL.name, y + 5, unlocked ? info.name : '???', {
        ...cell,
        color: unlocked ? PAL.white : PAL.grey,
      });
      if (rec.isBeaten(id)) {
        this.add
          .image(COL.trophy, y, iconKey('trophy'))
          .setOrigin(0, 0)
          .setDepth(UI_DEPTH + 2);
      }
      const num = { ...cell, align: 'center' } as const;
      new Label(this, COL.pb, y + 5, formatTime(rec.bestMs(id)), { ...num, color: PAL.gold });
      new Label(this, COL.target, y + 5, formatTime(info.targetMs), num);
      rec.recent(id, 3).forEach((e, j) => {
        const x = COL.last[j];
        if (x !== undefined) new Label(this, x, y + 5, historyCell(e), num);
      });
    });

    const total = rec.ladderTotalMs();
    new Label(
      this,
      160,
      148,
      total === null ? 'BEAT ALL 7 TO SET A LADDER TOTAL' : `LADDER TOTAL ${formatLadderTotal(total)}`,
      { align: 'center', color: total === null ? PAL.lightGrey : PAL.gold },
    );
    new Label(this, 160, 166, 'UP/DOWN: SELECT    ESC: BACK', {
      font: FONT_MINI,
      align: 'center',
      color: PAL.grey,
    });

    this.drawHighlight();
    playMusic('ladder');
    onMenuKeys(this, (action) => {
      if (action === 'up' || action === 'down') {
        const next = Math.min(OPPONENT_IDS.length - 1, Math.max(0, this.row + (action === 'down' ? 1 : -1)));
        if (next !== this.row) {
          this.row = next;
          playSfx('menu_move');
          this.drawHighlight();
        }
      } else if (action === 'back') {
        playSfx('menu_back');
        goTo(this, SceneKey.Ladder);
      }
    });
  }

  private drawHighlight(): void {
    const g = this.highlight;
    g.clear();
    const y = ROW_Y + this.row * ROW_H;
    fillRect(g, 4, y, 312, ROW_H, PAL.shadowDark);
    fillRect(g, 4, y, 2, ROW_H, PAL.gold);
  }
}
