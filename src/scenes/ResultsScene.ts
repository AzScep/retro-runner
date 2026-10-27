import Phaser from 'phaser';
import {
  formatMargin,
  formatTime,
  OPPONENTS,
  PLAYER,
  type RaceOutcome,
  type RecordOutcome,
} from '../core/index.ts';
import { GAME_HEIGHT, portraitKey } from '../art/index.ts';
import { duckMusic, playSfx } from '../audio/index.ts';
import { flashHz, flashOn, PAL } from '../ui/hudMath.ts';
import { resultTimeText, resultTitle } from '../ui/screenText.ts';
import { Label } from '../ui/text.ts';
import { addPanel, ButtonRow, UI_DEPTH } from '../ui/widgets.ts';
import { applyCrt, getApp, goTo, nextOpponent, onMenuKeys, SceneKey, settings } from './app.ts';

export interface ResultsData {
  readonly outcome: RaceOutcome;
  readonly record: RecordOutcome;
}

type ButtonId = 'next' | 'retry' | 'map';

// Design 6.6 says 200 px; 216 gives PHOTO FINISH and DISQUALIFIED (192 px at 2x) a 12 px margin.
const CARD = { x: 52, y: 28, w: 216, h: 124 } as const;
const ROW_STEP = 14;
/** Widest title drawn at 2x, leaving at least 8 px inside the card on each side. */
const TITLE_2X_MAX_W = CARD.w - 24;
const SLIDE_MS = 250;
/** The card starts fully below the 180 px screen. */
const SLIDE_FROM = GAME_HEIGHT - CARD.y;
const JINGLE_MS = 2500;
/**
 * Left/Right are both run keys and button keys. A press within this gap of the previous one is
 * still mashing (runners finish at ~10 alt/s, about 100 ms apart), so it must not move the focus.
 */
const MASH_GAP_MS = 250;

/** S5 Results card (design 6.6), drawn over the still-running RaceScene. */
export class ResultsScene extends Phaser.Scene {
  private card!: Phaser.GameObjects.Container;
  private newPb: Label | null = null;
  private t0 = 0;
  private results!: ResultsData;

  constructor() {
    super(SceneKey.Results);
  }

  create(data: ResultsData): void {
    this.results = data;
    this.newPb = null;
    applyCrt(this);
    const { outcome, record } = data;
    const rival = OPPONENTS[outcome.opponent];
    const win = outcome.result === 'win';
    const x0 = CARD.x;
    const y0 = CARD.y;
    const objs: Phaser.GameObjects.GameObject[] = [];
    const add = (l: Label): Label => {
      objs.push(...l.objects());
      return l;
    };

    objs.push(addPanel(this, x0, y0, CARD.w, CARD.h));

    // Title (2x where it fits the card; "DID NOT FINISH" is 224 px at 2x, so it drops to 1x).
    const title = resultTitle(outcome);
    const fits2x = title.text.length * 16 <= TITLE_2X_MAX_W;
    add(
      new Label(this, 160, y0 + (fits2x ? 8 : 12), title.text, {
        scale: fits2x ? 2 : 1,
        color: title.color,
        align: 'center',
        depth: UI_DEPTH + 1,
      }),
    );

    // Player and rival rows.
    const rowX = x0 + 8;
    const valueX = x0 + CARD.w - 8;
    objs.push(
      this.add
        .image(rowX, y0 + 28, portraitKey('rio', 16))
        .setOrigin(0, 0)
        .setDepth(UI_DEPTH + 1),
    );
    add(new Label(this, rowX + 20, y0 + 32, PLAYER.name, { depth: UI_DEPTH + 1 }));
    add(
      new Label(this, valueX, y0 + 32, resultTimeText(outcome), {
        align: 'right',
        depth: UI_DEPTH + 1,
      }),
    );
    objs.push(
      this.add
        .image(rowX, y0 + 44, portraitKey(outcome.opponent, 16))
        .setOrigin(0, 0)
        .setDepth(UI_DEPTH + 1),
    );
    add(new Label(this, rowX + 20, y0 + 48, rival.name, { depth: UI_DEPTH + 1 }));
    add(
      new Label(this, valueX, y0 + 48, formatTime(outcome.oppMs), {
        align: 'right',
        depth: UI_DEPTH + 1,
      }),
    );

    // Detail rows stack 14 px apart from y 64, so DQ and DNF (no margin) leave no hole. Labels sit
    // on the left and values share the right-aligned time column.
    let rowY = y0 + 64;
    const left = (text: string, color: number = PAL.white): Label =>
      add(new Label(this, rowX, rowY, text, { color, depth: UI_DEPTH + 1 }));
    const right = (text: string): Label =>
      add(new Label(this, valueX, rowY, text, { align: 'right', depth: UI_DEPTH + 1 }));
    if (outcome.marginMs !== null) {
      left('MARGIN');
      right(formatMargin(outcome.marginMs));
      rowY += ROW_STEP;
    }
    const best = getApp().records.bestMs(outcome.opponent);
    if (record.newPb) {
      this.newPb = left('NEW PB!', PAL.gold);
      if (record.previousPbMs !== null) right(`OLD ${formatTime(record.previousPbMs)}`);
    } else {
      left('PB');
      right(formatTime(best));
    }
    rowY += ROW_STEP;
    const unlockText = record.unlocked
      ? `${OPPONENTS[record.unlocked].name} UNLOCKED!`
      : record.becameChampion
        ? 'LADDER CHAMPION!'
        : null;
    if (unlockText !== null) {
      add(new Label(this, 160, rowY, unlockText, { color: PAL.gold, align: 'center', depth: UI_DEPTH + 1 }));
    }

    // Buttons: NEXT only if the next tier is unlocked (or the champion screen awaits).
    const next = nextOpponent(outcome.opponent);
    const hasNext = record.becameChampion || (next !== null && getApp().records.isUnlocked(next));
    const items = [
      ...(hasNext ? [{ id: 'next' as const, label: 'NEXT' }] : []),
      { id: 'retry' as const, label: 'RETRY' },
      { id: 'map' as const, label: 'MAP' },
    ];
    const buttons = new ButtonRow<ButtonId>(this, items, {
      centerX: 160,
      y: y0 + 108,
      gap: 4,
      initial: win && hasNext ? 'next' : 'retry',
    });
    for (const l of buttons.labels()) objs.push(...l.objects());

    // Slide in from the bottom over 0.25 s, whole pixels only.
    this.card = this.add.container(0, SLIDE_FROM, objs).setDepth(UI_DEPTH);
    this.t0 = this.game.loop.time; // Clock.now is stale until the first preUpdate.

    duckMusic(true);
    playSfx(win ? 'win_jingle' : 'lose_jingle');
    if (record.newPb) this.time.delayedCall(700, () => playSfx('new_pb'));
    if (record.unlocked) this.time.delayedCall(1300, () => playSfx('unlock'));
    this.time.delayedCall(JINGLE_MS, () => duckMusic(false));

    // Counts the card's appearance as a press, so mashing straight through it never navigates.
    let lastArrowMs = this.t0;
    onMenuKeys(this, (action) => {
      switch (action) {
        case 'left':
        case 'right': {
          const now = this.game.loop.time;
          const mashing = now - lastArrowMs < MASH_GAP_MS;
          lastArrowMs = now;
          if (!mashing && buttons.move(action === 'left' ? -1 : 1)) playSfx('menu_move');
          return;
        }
        case 'confirm':
          playSfx('menu_select');
          this.choose(buttons.focusedId ?? 'retry');
          return;
        case 'retry':
          playSfx('menu_select');
          this.choose('retry');
          return;
        case 'back':
          playSfx('menu_back');
          this.choose('map');
          return;
        default:
          return;
      }
    });
  }

  private choose(id: ButtonId): void {
    const { outcome, record } = this.results;
    const app = getApp();
    if (id === 'next') {
      if (record.becameChampion) {
        goTo(this, SceneKey.Champion);
        return;
      }
      const next = nextOpponent(outcome.opponent);
      if (next === null || !app.records.isUnlocked(next)) return;
      app.ladderCursor = next;
      goTo(this, SceneKey.Race, { opponent: next });
    } else if (id === 'retry') {
      app.ladderCursor = outcome.opponent;
      goTo(this, SceneKey.Race, { opponent: outcome.opponent });
    } else {
      goTo(this, SceneKey.Ladder);
    }
  }

  update(time: number): void {
    const t = Math.min(1, (time - this.t0) / SLIDE_MS);
    const eased = 1 - (1 - t) * (1 - t);
    this.card.setY(Math.round(SLIDE_FROM * (1 - eased)));
    if (this.newPb) {
      this.newPb.setVisible(flashOn(time - this.t0, flashHz(2, settings().reducedFlashing)));
    }
  }
}
