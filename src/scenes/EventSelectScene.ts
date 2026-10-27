import Phaser from 'phaser';
import { EVENT_IDS, EVENT_LOCK_TEXT, formatLadderTotal, type EventId } from '../core/index.ts';
import { createStadium, eventIconKey, iconKey, paletteColor, type Stadium } from '../art/index.ts';
import { playMusic, playSfx } from '../audio/index.ts';
import { FONT_MINI } from '../ui/fonts.ts';
import { PAL } from '../ui/hudMath.ts';
import type { MenuAction } from '../ui/keys.ts';
import { MINI_LINE_HEIGHT, wrapMini } from '../ui/miniFont.ts';
import { EVENT_CARD_NAME } from '../ui/screenText.ts';
import { registerTapTarget } from '../ui/tapTargets.ts';
import { Label } from '../ui/text.ts';
import { ButtonRow, drawPanel, UI_DEPTH } from '../ui/widgets.ts';
import {
  applyCrt,
  getApp,
  goTo,
  isTouch,
  ladderIds,
  onMenuKeys,
  restartOnModalityChange,
  SceneKey,
  settings,
} from './app.ts';

type MenuId = 'back' | 'records' | 'options';

/** Design 18.2: three 96 x 120 cards at x 8, 112, 216, y 30; menu row at y 160. */
const CARD_W = 96;
const CARD_H = 120;
const CARD_Y = 30;
const CARD_X: readonly number[] = [8, 112, 216];
const MENU_Y = 160;
const MENU_BAR = { x: 56, y: 154, w: 208, h: 22 } as const;
const SCROLL_PX_PER_S = 8;
const SHAKE_FRAMES = 4;

interface Card {
  readonly event: EventId;
  readonly x: number;
  readonly objs: { readonly obj: { x: number }; readonly x: number }[];
}

/** S10 Event Select (design 18.2): event cards with locks, progress and totals. */
export class EventSelectScene extends Phaser.Scene {
  private stadium: Stadium | null = null;
  private frames!: Phaser.GameObjects.Graphics;
  private cards: Card[] = [];
  private cursor = 0;
  private row: 'cards' | 'menu' = 'cards';
  private menu!: ButtonRow<MenuId>;
  private t0 = 0;
  private shakeCard = -1;
  private shakeFrames = 0;

  constructor() {
    super(SceneKey.Events);
  }

  create(): void {
    const app = getApp();
    const rec = app.records;
    this.cameras.main.setBackgroundColor(paletteColor(PAL.ink));
    applyCrt(this);
    this.cards = [];
    this.row = 'cards';
    this.shakeCard = -1;
    this.shakeFrames = 0;
    const start = EVENT_IDS.indexOf(rec.data.lastEvent);
    this.cursor = start >= 0 ? start : 0;

    // Background: stadium of the highest unlocked 100 m tier, scrolling slowly.
    const tier = Math.max(1, ...ladderIds('100m').map((id, i) => (rec.isUnlocked('100m', id) ? i + 1 : 1)));
    this.stadium = createStadium(this, tier);
    this.stadium.scrollTo(0);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.stadium?.destroy();
      this.stadium = null;
    });

    new Label(this, 160, 6, 'SELECT EVENT', { scale: 2, align: 'center', color: PAL.gold, outline: true });
    this.frames = this.add.graphics().setDepth(UI_DEPTH);
    EVENT_IDS.forEach((event, i) => this.buildCard(event, CARD_X[i] ?? 0, i));

    const bar = this.add.graphics().setDepth(UI_DEPTH);
    drawPanel(bar, MENU_BAR.x, MENU_BAR.y, MENU_BAR.w, MENU_BAR.h);
    const touch = isTouch();
    this.menu = new ButtonRow<MenuId>(
      this,
      [
        ...(touch ? [{ id: 'back' as const, label: 'BACK' }] : []),
        { id: 'records', label: 'RECORDS' },
        { id: 'options', label: 'OPTIONS' },
      ],
      { centerX: 160, y: MENU_Y, gap: -4, initial: 'records' },
    );
    this.menu.enableTaps(this, (id) => this.confirmMenu(id));
    this.refresh();

    this.t0 = this.game.loop.time;
    playMusic('ladder');
    restartOnModalityChange(this);
    onMenuKeys(this, (action) => this.onAction(action));
  }

  private buildCard(event: EventId, x: number, index: number): void {
    const rec = getApp().records;
    const unlocked = rec.isEventUnlocked(event);
    const objs: Card['objs'] = [];
    const keep = <T extends { x: number }>(obj: T): T => {
      objs.push({ obj, x: obj.x });
      return obj;
    };
    const keepLabel = (l: Label): Label => {
      for (const o of l.objects()) keep(o);
      return l;
    };
    const depth = UI_DEPTH + 2;
    const cx = x + CARD_W / 2;
    keep(
      this.add
        .image(x + 32, CARD_Y + 8, eventIconKey(event, 32, !unlocked))
        .setOrigin(0, 0)
        .setDepth(depth),
    );
    EVENT_CARD_NAME[event].forEach((line, i) => {
      keepLabel(
        new Label(this, cx, CARD_Y + 46 + i * 10, line, {
          align: 'center',
          color: unlocked ? PAL.white : PAL.grey,
          depth,
        }),
      );
    });

    if (unlocked) {
      const er = rec.data.events[event];
      keep(
        this.add
          .image(x + 18, CARD_Y + 68, iconKey('trophy'))
          .setOrigin(0, 0)
          .setDepth(depth),
      );
      keepLabel(new Label(this, x + 38, CARD_Y + 72, `${er.beaten.length}/7`, { depth }));
      if (er.champion) {
        keep(
          this.add
            .image(x + 72, CARD_Y + 72, iconKey('crown'))
            .setOrigin(0, 0)
            .setDepth(depth),
        );
      }
      keepLabel(
        new Label(this, cx, CARD_Y + 92, 'TOTAL', {
          font: FONT_MINI,
          align: 'center',
          color: PAL.lightGrey,
          depth,
        }),
      );
      const total = rec.ladderTotalMs(event);
      keepLabel(
        new Label(this, cx, CARD_Y + 102, total === null ? '--' : formatLadderTotal(total), {
          align: 'center',
          color: total === null ? PAL.lightGrey : PAL.gold,
          depth,
        }),
      );
      if (!rec.data.seenEvents.includes(event)) {
        keep(
          this.add
            .image(x + CARD_W - 27, CARD_Y + 3, iconKey('newBadge'))
            .setOrigin(0, 0)
            .setDepth(depth + 1),
        );
      }
    } else {
      keep(
        this.add
          .image(cx - 8, CARD_Y + 66, iconKey('lock'))
          .setOrigin(0, 0)
          .setDepth(depth),
      );
      const lines = EVENT_LOCK_TEXT[event].flatMap((l) => wrapMini(l, CARD_W - 12));
      lines.forEach((line, i) => {
        keepLabel(
          new Label(this, cx, CARD_Y + 86 + i * (MINI_LINE_HEIGHT + 1), line, {
            font: FONT_MINI,
            align: 'center',
            color: PAL.midGrey,
            depth,
          }),
        );
      });
    }
    this.cards.push({ event, x, objs });

    // List item (design 17.5.3): first tap selects, a tap on the selected card confirms.
    registerTapTarget(this, { x, y: CARD_Y, w: CARD_W, h: CARD_H }, () => {
      if (this.row === 'cards' && this.cursor === index) {
        this.confirmCard();
        return;
      }
      this.row = 'cards';
      this.cursor = index;
      playSfx('menu_move');
      this.refresh();
    });
  }

  private onAction(action: MenuAction): void {
    switch (action) {
      case 'left':
      case 'right': {
        const d = action === 'left' ? -1 : 1;
        if (this.row === 'cards') {
          const next = this.cursor + d;
          if (next >= 0 && next < this.cards.length) {
            this.cursor = next;
            playSfx('menu_move');
            this.refresh();
          }
        } else if (this.menu.move(d)) {
          playSfx('menu_move');
        }
        return;
      }
      case 'up':
      case 'down': {
        const row = action === 'down' ? 'menu' : 'cards';
        if (row !== this.row) {
          this.row = row;
          playSfx('menu_move');
          this.refresh();
        }
        return;
      }
      case 'confirm':
        if (this.row === 'cards') this.confirmCard();
        else this.confirmMenu(this.menu.focusedId ?? 'records');
        return;
      case 'back':
        playSfx('menu_back');
        goTo(this, SceneKey.Title);
        return;
      default:
        return;
    }
  }

  private focusedEvent(): EventId {
    return this.cards[this.cursor]?.event ?? '100m';
  }

  private confirmCard(): void {
    const app = getApp();
    const event = this.focusedEvent();
    if (!app.records.isEventUnlocked(event)) {
      playSfx('menu_back');
      const s = settings();
      // The 2 px shake is motion like screen shake: off with reduced flashing or shake off.
      if (s.screenShake && !s.reducedFlashing) {
        this.shakeCard = this.cursor;
        this.shakeFrames = SHAKE_FRAMES;
      }
      return;
    }
    playSfx('menu_select');
    app.event = event;
    goTo(this, SceneKey.Ladder);
  }

  private confirmMenu(id: MenuId): void {
    if (id === 'back') {
      playSfx('menu_back');
      goTo(this, SceneKey.Title);
      return;
    }
    playSfx('menu_select');
    if (id === 'records') goTo(this, SceneKey.Records, { event: this.focusedEvent(), from: SceneKey.Events });
    else goTo(this, SceneKey.Options, { from: SceneKey.Events });
  }

  private refresh(): void {
    const rec = getApp().records;
    const g = this.frames;
    g.clear();
    this.cards.forEach((c, i) => {
      const selected = this.row === 'cards' && i === this.cursor;
      const unlocked = rec.isEventUnlocked(c.event);
      drawPanel(
        g,
        c.x + this.shakeOffset(i),
        CARD_Y,
        CARD_W,
        CARD_H,
        selected ? PAL.gold : unlocked ? PAL.white : PAL.grey,
      );
    });
    this.menu.setActive(this.row === 'menu');
  }

  private shakeOffset(i: number): number {
    if (i !== this.shakeCard || this.shakeFrames <= 0) return 0;
    return this.shakeFrames % 2 === 0 ? 2 : -2;
  }

  update(time: number): void {
    this.stadium?.scrollTo(Math.floor(((time - this.t0) / 1000) * SCROLL_PX_PER_S));
    if (this.shakeFrames > 0) {
      const card = this.cards[this.shakeCard];
      this.shakeFrames--;
      const dx = this.shakeOffset(this.shakeCard);
      if (card) for (const o of card.objs) o.obj.x = o.x + dx;
      this.refresh();
    }
  }
}
