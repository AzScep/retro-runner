import Phaser from 'phaser';
import { formatTime, OPPONENTS, type RaceOutcome, type RecordOutcome, type Standing } from '../core/index.ts';
import { fieldPortraitKey, GAME_HEIGHT, medalKey, portraitKey } from '../art/index.ts';
import { duckMusic, playSfx } from '../audio/index.ts';
import { FONT_MINI } from '../ui/fonts.ts';
import { flashHz, flashOn, PAL } from '../ui/hudMath.ts';
import {
  EVENT_TITLE,
  marginText,
  medalRow,
  ordinal,
  pbGapText,
  RESULT_FACTS_W,
  resultFacts,
  resultTitle,
  unlockHint,
  type NextTier,
} from '../ui/screenText.ts';
import { Label } from '../ui/text.ts';
import { addPanel, ButtonRow, fillRect, UI_DEPTH } from '../ui/widgets.ts';
import { applyCrt, getApp, goTo, nextOpponent, onMenuKeys, SceneKey, settings } from './app.ts';
import type { RevealData } from './RevealScene.ts';

export interface ResultsData {
  readonly outcome: RaceOutcome;
  readonly record: RecordOutcome;
}

type ButtonId = 'next' | 'retry' | 'map' | 'continue';

/** Design 28.1: (8, 12, 304 x 156); table on the left (panel x 8-176), facts on the right (184-300). */
const CARD = { x: 8, y: 12, w: 304, h: 156 } as const;
const TABLE = { x: 8, right: 176, rowY: 28, rowH: 16 } as const;
const FACTS = { x: 184, right: 184 + RESULT_FACTS_W } as const;
const ROW = {
  title: 6,
  margin: 28,
  facts: 40,
  /** `NEW PB!` and the plain `PB 11.52` both start 4 px clear of a third facts line (ends at 66). */
  pb: 70,
  old: 88,
  pbLine: 70,
  /** `+0.12 OFF PB` (mini font) right under the plain PB line. */
  pbGap: 80,
  medal: 98,
  eventUnlock: 110,
  buttons: 134,
} as const;
const SLIDE_MS = 250;
/** The card starts fully below the 180 px screen. */
const SLIDE_FROM = GAME_HEIGHT - CARD.y;
const JINGLE_MS = 2500;
/**
 * Left/Right are both run keys and button keys. A press within this gap of the previous one is
 * still mashing (runners finish at ~10 alt/s, about 100 ms apart), so it must not move the focus.
 */
const MASH_GAP_MS = 250;
const D = UI_DEPTH + 1;

/** S5 Results card v3 (design 28), drawn over the still-running RaceScene. */
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
    const app = getApp();
    const rival = OPPONENTS[outcome.opponent];
    const win = outcome.result === 'win';
    const x0 = CARD.x;
    const y0 = CARD.y;
    const objs: Phaser.GameObjects.GameObject[] = [];
    const add = (l: Label): Label => {
      objs.push(...l.objects());
      return l;
    };
    const text = (x: number, y: number, s: string, opts: ConstructorParameters<typeof Label>[4] = {}) =>
      add(new Label(this, x0 + x, y0 + y, s, { depth: D, ...opts }));

    objs.push(addPanel(this, x0, y0, CARD.w, CARD.h));

    // Title, 2x, centred across the panel.
    const title = resultTitle(outcome);
    text(CARD.w / 2, ROW.title, title.text, { scale: 2, color: title.color, align: 'center' });

    // Placings table: 6 rows of 16 px, the player's DQ/DNF row last (24.1, 28.2). A DQ ran no race,
    // so only the player's row shows, over `RACE NOT RUN` instead of a table of dashes (R8).
    const table = this.add.graphics().setDepth(D);
    objs.push(table);
    if (outcome.result === 'dq') {
      outcome.standings.filter((s) => s.lane === 0).forEach((s, i) => this.tableRow(s, i, table, objs, text));
      text((TABLE.x + TABLE.right) / 2, TABLE.rowY + TABLE.rowH, 'RACE NOT RUN', {
        color: PAL.lightGrey,
        align: 'center',
      });
    } else {
      outcome.standings.forEach((s, i) => this.tableRow(s, i, table, objs, text));
    }

    // Right column: margin, facts, PB, medal / unlock, event unlock.
    const margin = marginText(outcome);
    if (margin !== null) text(FACTS.x, ROW.margin, margin);
    let factY = ROW.facts;
    for (const f of resultFacts(outcome)) {
      text(FACTS.x, factY, f.text, { color: f.color, ...(f.big ? {} : { font: FONT_MINI }) });
      factY += f.big ? 10 : 9;
    }

    const best = app.records.bestMs(outcome.event, outcome.opponent);
    if (record.newPb) {
      this.newPb = text(FACTS.x, ROW.pb, 'NEW PB!', { scale: 2, color: PAL.gold });
      if (record.previousPbMs !== null) text(FACTS.x, ROW.old, `OLD ${formatTime(record.previousPbMs)}`);
    } else {
      text(FACTS.x, ROW.pbLine, `PB ${formatTime(best)}`);
      const gap = pbGapText(outcome.ms, best);
      if (gap !== null) text(FACTS.x, ROW.pbGap, gap, { font: FONT_MINI, color: PAL.lightGrey });
    }

    const medal = medalRow({
      outcome,
      unlockedName: record.unlocked ? OPPONENTS[record.unlocked].name : null,
      becameChampion: record.becameChampion,
      revealPending: record.revealPending,
      newBestPlace: record.newBestPlace,
      rivalName: rival.name,
    });
    if (medal !== null) {
      let medalX = FACTS.x;
      if (medal.medal !== null) {
        objs.push(
          this.add
            .image(x0 + FACTS.x, y0 + ROW.medal, medalKey(medal.medal))
            .setOrigin(0, 0)
            .setDepth(D),
        );
        medalX += 12;
      }
      this.fitText(text, ROW.medal, medal.text, medal.color, medalX);
    }

    // The next tier is still locked after a non-1st finish: say that only 1st unlocks it (M1).
    const next = nextOpponent(outcome.event, outcome.opponent);
    const locked: NextTier | null =
      next !== null && !app.records.isUnlocked(outcome.event, next)
        ? {
            name: OPPONENTS[next].name,
            // Tier 7 is the last tier and stays unnamed until the reveal (design 30).
            hidden: nextOpponent(outcome.event, next) === null && !app.records.isRevealed(outcome.event),
          }
        : null;
    const hint = record.unlockedEvent === null ? unlockHint(outcome, locked) : null;
    if (hint !== null) {
      text(FACTS.x, ROW.eventUnlock, hint[0], { font: FONT_MINI, color: PAL.white });
      text(FACTS.x, ROW.eventUnlock + 9, hint[1], { font: FONT_MINI, color: PAL.gold });
    }
    if (record.unlockedEvent !== null) {
      // Two mini lines: the full line is wider than the 116 px column.
      text(FACTS.x, ROW.eventUnlock, 'NEW EVENT:', { font: FONT_MINI, color: PAL.gold });
      text(FACTS.x, ROW.eventUnlock + 9, EVENT_TITLE[record.unlockedEvent], {
        font: FONT_MINI,
        color: PAL.gold,
      });
    }

    // Buttons: a pending reveal replaces them with CONTINUE (30.1.2); NEXT only if the next tier
    // is unlocked (or the champion screen awaits).
    const hasNext = record.becameChampion || (next !== null && app.records.isUnlocked(outcome.event, next));
    const items: { id: ButtonId; label: string }[] = record.revealPending
      ? [{ id: 'continue', label: 'CONTINUE' }]
      : [
          ...(hasNext ? [{ id: 'next' as const, label: 'NEXT' }] : []),
          { id: 'retry', label: 'RETRY' },
          { id: 'map', label: 'MAP' },
        ];
    const buttons = new ButtonRow<ButtonId>(this, items, {
      centerX: 160,
      y: y0 + ROW.buttons,
      gap: 4,
      initial: record.revealPending ? 'continue' : win && hasNext ? 'next' : 'retry',
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
      const pending = record.revealPending;
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
          this.choose(buttons.focusedId ?? (pending ? 'continue' : 'retry'));
          return;
        case 'retry':
          if (pending) return;
          playSfx('menu_select');
          this.choose('retry');
          return;
        case 'back':
          if (pending) return;
          playSfx('menu_back');
          this.choose('map');
          return;
        default:
          return;
      }
    });
  }

  /** One placings row (28.1, 28.2): place, portrait, name, time; the player row highlighted. */
  private tableRow(
    s: Standing,
    i: number,
    g: Phaser.GameObjects.Graphics,
    objs: Phaser.GameObjects.GameObject[],
    text: (x: number, y: number, s: string, opts?: ConstructorParameters<typeof Label>[4]) => Label,
  ): void {
    const y = TABLE.rowY + i * TABLE.rowH;
    const top = CARD.y + y - 4;
    if (s.lane === 0) {
      // Fill index 3 across the column, 1 px index 22 border, 5x5 index 22 pointer at the left edge.
      fillRect(g, CARD.x + TABLE.x, top, TABLE.right - TABLE.x, TABLE.rowH, PAL.gold);
      fillRect(g, CARD.x + TABLE.x + 1, top + 1, TABLE.right - TABLE.x - 2, TABLE.rowH - 2, PAL.shadowDark);
      fillRect(g, CARD.x + TABLE.x - 3, top + 5, 5, 5, PAL.gold);
    }
    const placeText = s.place === null ? '' : ordinal(s.place);
    text(TABLE.x + 4, y + 1, placeText, { font: FONT_MINI, color: s.lane === 0 ? PAL.gold : PAL.white });
    const key = s.who.kind === 'field' ? fieldPortraitKey(s.who.field) : portraitKey(s.who.id, 16);
    objs.push(
      this.add
        .image(CARD.x + TABLE.x + 24, top, key)
        .setOrigin(0, 0)
        .setDepth(D),
    );
    const nameColor = s.lane === 0 ? PAL.white : s.lane === 1 ? PAL.gold : PAL.lightGrey;
    text(TABLE.x + 44, y, s.name, { color: nameColor });
    const time =
      s.ms !== null
        ? formatTime(s.ms)
        : s.lane === 0
          ? this.results.outcome.result === 'dnf'
            ? 'DNF'
            : 'DQ'
          : formatTime(null);
    text(TABLE.right - 4, y, time, { align: 'right' });
  }

  /**
   * One 8 px line of the right column at `y`, dropping to the mini font (1 px lower) when it is
   * wider than the column (`VALENTINA UNLOCKED!`, `CHAMPIONSHIP WON!`).
   */
  private fitText(
    text: (x: number, y: number, s: string, opts?: ConstructorParameters<typeof Label>[4]) => Label,
    y: number,
    s: string,
    color: number,
    x: number = FACTS.x,
  ): void {
    const fits8 = s.length * 8 <= FACTS.right - x;
    text(x, y + (fits8 ? 0 : 1), s, { color, ...(fits8 ? {} : { font: FONT_MINI }) });
  }

  private choose(id: ButtonId): void {
    const { outcome, record } = this.results;
    const app = getApp();
    if (id === 'continue') {
      const data: RevealData = {
        event: outcome.event,
        version: app.records.revealSeen() ? 'short' : 'full',
      };
      goTo(this, SceneKey.Reveal, data);
      return;
    }
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
      goTo(this, SceneKey.Race, { event: outcome.event, opponent: outcome.opponent, retry: true });
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
      // Always readable: the flash swaps gold and white instead of blanking the row (2 Hz, 1 Hz reduced).
      const on = flashOn(time - this.t0, flashHz(2, settings().reducedFlashing));
      this.newPb.setColor(on ? PAL.gold : PAL.white);
    }
  }
}
