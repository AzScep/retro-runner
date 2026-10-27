import Phaser from 'phaser';
import {
  EVENT_IDS,
  EVENT_LOCK_TEXT,
  formatLadderTotal,
  formatTime,
  ladderEntry,
  OPPONENTS,
  type EventId,
} from '../core/index.ts';
import { iconKey, paletteColor, portraitKey } from '../art/index.ts';
import { playMusic, playSfx } from '../audio/index.ts';
import { FONT_MINI } from '../ui/fonts.ts';
import { PAL } from '../ui/hudMath.ts';
import type { MenuAction } from '../ui/keys.ts';
import { EVENT_TAB, hitCell, historyCell, splitsRow } from '../ui/screenText.ts';
import { registerTapTarget } from '../ui/tapTargets.ts';
import { Label } from '../ui/text.ts';
import { ButtonRow, drawPanel, fillRect, UI_DEPTH } from '../ui/widgets.ts';
import {
  applyCrt,
  getApp,
  goTo,
  isTouch,
  ladderIds,
  onMenuKeys,
  restartOnModalityChange,
  SceneKey,
} from './app.ts';

export interface RecordsData {
  /** Tab to open (design 18.1: S10 RECORDS opens the focused event's tab). */
  readonly event?: EventId;
  /** Where Esc / BACK returns to. */
  readonly from?: typeof SceneKey.Ladder | typeof SceneKey.Events;
  /** Row to keep selected across a tab switch. */
  readonly row?: number;
}

/** Tab strip (design 18.7.1): three 64 x 14 tabs at y 4. */
const TAB = { y: 4, w: 64, h: 14, x: [32, 128, 224] } as const;
// The column headers need a line of their own between the tabs and the 7 rows, so the table starts
// at y 32 (design 18.7.3 says 24) and keeps the 16 px row pitch.
const PANEL = { x: 2, y: 20, w: 316, h: 126 } as const;
const HEAD_Y = 23;
const ROW_Y = 32;
const ROW_H = 16;
const TOTAL_Y = 149;
const SPLITS_Y = 160;
const HELP_Y = 171;

/**
 * Column x positions per event. Name and icons are left edges; time columns are centres, so 'DQ',
 * 'DNF', '--.--', '12.34' and '1:04.37' all sit centred under their header. Hurdles adds HIT after PB.
 */
interface Columns {
  readonly portrait: number;
  readonly name: number;
  readonly trophy: number;
  readonly pb: number;
  readonly hit: number | null;
  readonly target: number;
  readonly last: readonly number[];
}
const COLUMNS: Readonly<Record<EventId, Columns>> = {
  '100m': { portrait: 8, name: 28, trophy: 84, pb: 124, hit: null, target: 166, last: [214, 252, 290] },
  '110mh': { portrait: 8, name: 28, trophy: 84, pb: 118, hit: 144, target: 182, last: [222, 257, 292] },
  '400m': { portrait: 8, name: 28, trophy: 84, pb: 124, hit: null, target: 168, last: [216, 254, 292] },
};

/** S6 Records v2 (design 4.5, 18.7): event tabs, per-rival PB table, last results, ladder total. */
export class RecordsScene extends Phaser.Scene {
  private highlight!: Phaser.GameObjects.Graphics;
  private splits!: Label;
  private row = 0;
  private event: EventId = '100m';
  private from: NonNullable<RecordsData['from']> = SceneKey.Ladder;

  constructor() {
    super(SceneKey.Records);
  }

  create(data: RecordsData = {}): void {
    const app = getApp();
    const rec = app.records;
    this.event = data.event ?? app.event;
    this.from = data.from ?? SceneKey.Ladder;
    this.row = data.row ?? 0;
    this.cameras.main.setBackgroundColor(paletteColor(PAL.ink));
    applyCrt(this);
    const touch = isTouch();
    const unlocked = rec.isEventUnlocked(this.event);

    // Tabs: list items (17.5.3); a tap on another tab selects it.
    const tabs = this.add.graphics().setDepth(UI_DEPTH);
    EVENT_IDS.forEach((e, i) => {
      const x = TAB.x[i] ?? 0;
      const sel = e === this.event;
      drawPanel(tabs, x, TAB.y, TAB.w, TAB.h, sel ? PAL.white : PAL.darkGrey, PAL.panel);
      // A locked tab still opens; its page shows the lock and the unlock text (18.7.7).
      new Label(this, x + TAB.w / 2, TAB.y + 3, EVENT_TAB[e], {
        align: 'center',
        color: sel ? PAL.gold : PAL.midGrey,
        depth: UI_DEPTH + 1,
      });
      registerTapTarget(this, { x, y: TAB.y - 3, w: TAB.w, h: 20 }, () => this.selectTab(e));
    });

    const bg = this.add.graphics().setDepth(UI_DEPTH);
    drawPanel(bg, PANEL.x, PANEL.y, PANEL.w, PANEL.h);
    this.highlight = this.add.graphics().setDepth(UI_DEPTH + 1);
    this.splits = new Label(this, 160, SPLITS_Y, '', { font: FONT_MINI, align: 'center', color: PAL.white });

    if (unlocked) this.buildTable();
    else this.buildLocked();

    if (touch) {
      const back = new ButtonRow<'back'>(this, [{ id: 'back', label: 'BACK' }], {
        centerX: 160,
        y: HELP_Y - 3,
      });
      back.enableTaps(this, () => this.back());
    } else {
      const help = ['LEFT/RIGHT: EVENT', 'UP/DOWN: SELECT', 'ESC: BACK'];
      new Label(this, 160, HELP_Y, help.join('   '), { font: FONT_MINI, align: 'center', color: PAL.grey });
    }

    this.clearSplits();
    this.drawHighlight();
    playMusic('ladder');
    restartOnModalityChange(this, { event: this.event, from: this.from, row: this.row });
    onMenuKeys(this, (action) => this.onAction(action));
  }

  private buildTable(): void {
    const rec = getApp().records;
    const event = this.event;
    const col = COLUMNS[event];
    const head = { font: FONT_MINI, color: PAL.lightGrey, depth: UI_DEPTH + 2 } as const;
    const headCentre = { ...head, align: 'center' } as const;
    new Label(this, col.name, HEAD_Y, 'RIVAL', head);
    new Label(this, col.pb, HEAD_Y, 'PB', headCentre);
    if (col.hit !== null) new Label(this, col.hit, HEAD_Y, 'HIT', headCentre);
    new Label(this, col.target, HEAD_Y, 'TARGET', headCentre);
    new Label(this, col.last[1] ?? 0, HEAD_Y, 'LAST 3', headCentre);

    ladderIds(event).forEach((id, i) => {
      const y = ROW_Y + i * ROW_H;
      const info = OPPONENTS[id];
      const unlocked = rec.isUnlocked(event, id);
      const cell = { font: FONT_MINI, depth: UI_DEPTH + 2 } as const;
      this.add
        .image(col.portrait, y, portraitKey(id, 16, !unlocked))
        .setOrigin(0, 0)
        .setDepth(UI_DEPTH + 2);
      new Label(this, col.name, y + 5, unlocked ? info.name : '???', {
        ...cell,
        color: unlocked ? PAL.white : PAL.grey,
      });
      if (rec.isBeaten(event, id)) {
        this.add
          .image(col.trophy, y, iconKey('trophy'))
          .setOrigin(0, 0)
          .setDepth(UI_DEPTH + 2);
      }
      const num = { ...cell, align: 'center' } as const;
      const best = rec.best(event, id);
      new Label(this, col.pb, y + 5, formatTime(best?.ms ?? null), { ...num, color: PAL.gold });
      if (col.hit !== null) new Label(this, col.hit, y + 5, best ? hitCell(best.hit) : '-', num);
      new Label(this, col.target, y + 5, formatTime(ladderEntry(event, id)?.targetMs ?? null), num);
      rec.recent(event, id, 3).forEach((e, j) => {
        const x = col.last[j];
        if (x !== undefined) new Label(this, x, y + 5, historyCell(e), num);
      });
      // Rows are list items (17.5.3): first tap selects, a tap on the selected row shows splits.
      registerTapTarget(this, { x: 4, y, w: 312, h: ROW_H }, () => this.tapRow(i));
    });

    const total = rec.ladderTotalMs(event);
    new Label(
      this,
      160,
      TOTAL_Y,
      total === null ? 'BEAT ALL 7 TO SET A LADDER TOTAL' : `LADDER TOTAL ${formatLadderTotal(total)}`,
      { align: 'center', color: total === null ? PAL.lightGrey : PAL.gold },
    );
  }

  /** A locked event's tab shows the lock icon and the unlock text instead of the table (18.7.7). */
  private buildLocked(): void {
    this.add
      .image(152, 56, iconKey('lock'))
      .setOrigin(0, 0)
      .setDepth(UI_DEPTH + 2);
    EVENT_LOCK_TEXT[this.event].forEach((line, i) => {
      new Label(this, 160, 84 + i * 12, line, { align: 'center', color: PAL.midGrey, depth: UI_DEPTH + 2 });
    });
  }

  private onAction(action: MenuAction): void {
    switch (action) {
      case 'left':
      case 'right': {
        const i = EVENT_IDS.indexOf(this.event) + (action === 'left' ? -1 : 1);
        const e = EVENT_IDS[i];
        if (e) this.selectTab(e);
        return;
      }
      case 'up':
      case 'down': {
        const next = Math.min(6, Math.max(0, this.row + (action === 'down' ? 1 : -1)));
        if (next !== this.row) {
          this.row = next;
          playSfx('menu_move');
          this.clearSplits();
          this.drawHighlight();
        }
        return;
      }
      case 'confirm':
        this.showSplits();
        return;
      case 'back':
        this.back();
        return;
      default:
        return;
    }
  }

  private selectTab(e: EventId): void {
    if (e === this.event) return;
    playSfx('menu_move');
    // The restart lands on the next step; a second key press in the same frame must see the new tab.
    this.event = e;
    this.scene.restart({ event: e, from: this.from, row: this.row } satisfies RecordsData);
  }

  private tapRow(i: number): void {
    if (i === this.row) {
      this.showSplits();
      return;
    }
    this.row = i;
    playSfx('menu_move');
    this.clearSplits();
    this.drawHighlight();
  }

  /** 400 m: the selected rival's best-race splits in a one-line footer (18.7.5). */
  private showSplits(): void {
    if (this.event !== '400m' || !getApp().records.isEventUnlocked(this.event)) return;
    const id = ladderIds(this.event)[this.row];
    if (!id) return;
    const best = getApp().records.best(this.event, id);
    playSfx('menu_select');
    this.splits
      .setColor(PAL.white)
      .setText(
        best === null ? 'NO PB YET' : best.splits ? `PB SPLITS  ${splitsRow(best.splits)}` : 'PB SPLITS  -',
      );
  }

  /** 400 m footer: a hint until a row's splits are shown (Enter on keyboard, second tap on touch). */
  private clearSplits(): void {
    const show = this.event === '400m' && getApp().records.isEventUnlocked(this.event);
    this.splits
      .setText(show ? (isTouch() ? 'TAP A RIVAL AGAIN FOR PB SPLITS' : 'ENTER: PB SPLITS') : '')
      .setColor(PAL.grey);
  }

  private back(): void {
    playSfx('menu_back');
    goTo(this, this.from);
  }

  private drawHighlight(): void {
    const g = this.highlight;
    g.clear();
    if (!getApp().records.isEventUnlocked(this.event)) return;
    const y = ROW_Y + this.row * ROW_H;
    fillRect(g, 4, y, 312, ROW_H, PAL.shadowDark);
    fillRect(g, 4, y, 2, ROW_H, PAL.gold);
  }
}
