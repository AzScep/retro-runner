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
import { FONT_MINI } from '../ui/fonts.ts';
import { flashHz, flashOn, PAL } from '../ui/hudMath.ts';
import { EVENT_TITLE, hurdlesRow, resultTimeText, resultTitle, splitsRow } from '../ui/screenText.ts';
import { Label } from '../ui/text.ts';
import { addPanel, ButtonRow, UI_DEPTH } from '../ui/widgets.ts';
import { applyCrt, getApp, goTo, nextOpponent, onMenuKeys, SceneKey, settings } from './app.ts';

export interface ResultsData {
  readonly outcome: RaceOutcome;
  readonly record: RecordOutcome;
}

type ButtonId = 'next' | 'retry' | 'map';

// Design 18.6: (52, 22, 216 x 136) in every event, rows at fixed offsets.
const CARD = { x: 52, y: 22, w: 216, h: 136 } as const;
const ROW = {
  title: 8,
  player: 30,
  rival: 44,
  margin: 58,
  event: 72,
  pb: 86,
  unlock: 100,
  eventUnlock: 110,
  buttons: 120,
} as const;
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
      new Label(this, 160, y0 + ROW.title + (fits2x ? 0 : 4), title.text, {
        scale: fits2x ? 2 : 1,
        color: title.color,
        align: 'center',
        depth: UI_DEPTH + 1,
      }),
    );

    // Player and rival rows (times per 14.4).
    const rowX = x0 + 8;
    const valueX = x0 + CARD.w - 8;
    const row = (y: number, portrait: Phaser.GameObjects.Image, name: string, time: string): void => {
      objs.push(portrait.setOrigin(0, 0).setDepth(UI_DEPTH + 1));
      add(new Label(this, rowX + 20, y, name, { depth: UI_DEPTH + 1 }));
      add(new Label(this, valueX, y, time, { align: 'right', depth: UI_DEPTH + 1 }));
    };
    // The rival portrait goes first so the player's (one row above) is not clipped by it.
    row(
      y0 + ROW.rival,
      this.add.image(rowX, y0 + ROW.rival - 4, portraitKey(outcome.opponent, 16)),
      rival.name,
      formatTime(outcome.oppMs),
    );
    row(
      y0 + ROW.player,
      this.add.image(rowX, y0 + ROW.player - 4, portraitKey('rio', 16)),
      PLAYER.name,
      resultTimeText(outcome),
    );

    const left = (y: number, text: string, color: number = PAL.white): Label =>
      add(new Label(this, rowX, y0 + y, text, { color, depth: UI_DEPTH + 1 }));
    const right = (y: number, text: string): Label =>
      add(new Label(this, valueX, y0 + y, text, { align: 'right', depth: UI_DEPTH + 1 }));
    if (outcome.marginMs !== null) {
      left(ROW.margin, 'MARGIN');
      right(ROW.margin, formatMargin(outcome.marginMs));
    }

    // Event row (18.6): hurdles hit count, 400 m cumulative splits; empty in the 100 m and for DQ.
    if (outcome.event === '110mh' && outcome.hit !== null && outcome.result !== 'dq') {
      const h = hurdlesRow(outcome.hit);
      add(
        new Label(this, 160, y0 + ROW.event, h.text, {
          color: h.color,
          align: 'center',
          depth: UI_DEPTH + 1,
        }),
      );
    } else if (outcome.event === '400m' && outcome.result !== 'dq') {
      add(
        new Label(this, 160, y0 + ROW.event, splitsRow(outcome.splits), {
          font: FONT_MINI,
          align: 'center',
          depth: UI_DEPTH + 1,
        }),
      );
    }

    const best = getApp().records.bestMs(outcome.event, outcome.opponent);
    if (record.newPb) {
      this.newPb = left(ROW.pb, 'NEW PB!', PAL.gold);
      if (record.previousPbMs !== null) right(ROW.pb, `OLD ${formatTime(record.previousPbMs)}`);
    } else {
      left(ROW.pb, 'PB');
      right(ROW.pb, formatTime(best));
    }
    const unlockText = record.unlocked
      ? `${OPPONENTS[record.unlocked].name} UNLOCKED!`
      : record.becameChampion
        ? 'LADDER CHAMPION!'
        : null;
    if (unlockText !== null) {
      add(
        new Label(this, 160, y0 + ROW.unlock, unlockText, {
          color: PAL.gold,
          align: 'center',
          depth: UI_DEPTH + 1,
        }),
      );
    }
    if (record.unlockedEvent !== null) {
      add(
        new Label(this, 160, y0 + ROW.eventUnlock, `NEW EVENT: ${EVENT_TITLE[record.unlockedEvent]}`, {
          font: FONT_MINI,
          color: PAL.gold,
          align: 'center',
          depth: UI_DEPTH + 1,
        }),
      );
    }

    // Buttons: NEXT only if the next tier is unlocked (or the champion screen awaits).
    const next = nextOpponent(outcome.event, outcome.opponent);
    const hasNext =
      record.becameChampion || (next !== null && getApp().records.isUnlocked(outcome.event, next));
    const items = [
      ...(hasNext ? [{ id: 'next' as const, label: 'NEXT' }] : []),
      { id: 'retry' as const, label: 'RETRY' },
      { id: 'map' as const, label: 'MAP' },
    ];
    const buttons = new ButtonRow<ButtonId>(this, items, {
      centerX: 160,
      y: y0 + ROW.buttons,
      gap: 4,
      initial: win && hasNext ? 'next' : 'retry',
    });
    for (const l of buttons.labels()) objs.push(...l.objects());
    // Touch (17.5.4): one tap confirms. Targets sit at the card's final position.
    buttons.enableTaps(this, (id) => {
      playSfx('menu_select');
      this.choose(id);
    });

    // Slide in from the bottom over 0.25 s, whole pixels only.
    this.card = this.add.container(0, SLIDE_FROM, objs).setDepth(UI_DEPTH);
    this.t0 = this.game.loop.time; // Clock.now is stale until the first preUpdate.

    duckMusic(true);
    playSfx(win ? 'win_jingle' : 'lose_jingle');
    if (record.newPb) this.time.delayedCall(700, () => playSfx('new_pb'));
    if (record.unlocked || record.unlockedEvent) this.time.delayedCall(1300, () => playSfx('unlock'));
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
        goTo(this, SceneKey.Champion, { event: outcome.event });
        return;
      }
      const next = nextOpponent(outcome.event, outcome.opponent);
      if (next === null || !app.records.isUnlocked(outcome.event, next)) return;
      app.ladderCursor[outcome.event] = next;
      goTo(this, SceneKey.Race, { event: outcome.event, opponent: next });
    } else if (id === 'retry') {
      app.ladderCursor[outcome.event] = outcome.opponent;
      goTo(this, SceneKey.Race, { event: outcome.event, opponent: outcome.opponent });
    } else {
      app.event = outcome.event;
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
