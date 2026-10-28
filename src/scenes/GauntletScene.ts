import Phaser from 'phaser';
import {
  formatLadderTotal,
  formatTime,
  meet,
  TUNING,
  type EventId,
  type GauntletOutcome,
  type RaceOutcome,
} from '../core/index.ts';
import { createStadium, fieldPortraitKey, paletteColor, portraitKey, type Stadium } from '../art/index.ts';
import { duckMusic, playMusic, playSfx } from '../audio/index.ts';
import { FONT_MINI } from '../ui/fonts.ts';
import {
  furthestText,
  GAUNTLET_TIERS,
  gauntletQuitLine,
  gauntletTotal,
  newGauntletRun,
  showBestFurthest,
  type GauntletRun,
} from '../ui/gauntlet.ts';
import { PAL } from '../ui/hudMath.ts';
import { EVENT_TITLE, gauntletOutLine, ordinal } from '../ui/screenText.ts';
import { registerTapTarget } from '../ui/tapTargets.ts';
import { Label } from '../ui/text.ts';
import { addPanel, ButtonRow, UI_DEPTH } from '../ui/widgets.ts';
import { applyCrt, getApp, goTo, isTouch, onMenuKeys, rivalOfTier, SceneKey } from './app.ts';
import type { PauseData } from './PauseScene.ts';

export type GauntletCard = 'intro' | 'between' | 'over' | 'clear';

export interface GauntletData {
  readonly kind: GauntletCard;
  readonly event: EventId;
  /** intro: ignored; between: the run with the next tier; over: the run as it ended; clear: all 7 times. */
  readonly run: GauntletRun;
  /** The race that led here; null for the intro and an abandoned run. */
  readonly outcome: RaceOutcome | null;
  /** recordGauntletEnd's result for over and clear. */
  readonly end: GauntletOutcome | null;
  /** Drawn over the finished race (RaceScene still running), else on its own stadium. */
  readonly overRace: boolean;
  /** over: ABANDON RUN on the between-race card, before the run's next meet was raced. */
  readonly quitBefore?: boolean;
}

type ButtonId = 'start' | 'back' | 'newRun' | 'map';

const PANEL = { x: 32, y: 16, w: 256, h: 148 } as const;
const D = UI_DEPTH + 1;
const SLIDE_MS = 250;
const JINGLE_MS = 2500;
const CLEAR_FANFARE_MS = 3000;

/** S11 Gauntlet cards (design 32.1-32.2): intro, between-race, over and clear. */
export class GauntletScene extends Phaser.Scene {
  private cardData!: GauntletData;
  private stadium: Stadium | null = null;
  private card!: Phaser.GameObjects.Container;
  private t0 = 0;
  /** Between-race auto-advance deadline (game loop ms); paused while the pause menu is up. */
  private advanceAt = 0;
  private pausedAt: number | null = null;
  private leaving = false;
  private countLabel: Label | null = null;

  constructor() {
    super(SceneKey.Gauntlet);
  }

  create(data: GauntletData): void {
    this.cardData = data;
    this.leaving = false;
    this.pausedAt = null;
    this.countLabel = null;
    applyCrt(this);
    const app = getApp();
    app.event = data.event;
    if (!data.overRace) {
      this.cameras.main.setBackgroundColor(paletteColor(PAL.ink));
      const tier = data.kind === 'intro' ? 1 : Math.min(GAUNTLET_TIERS, data.run.tier);
      this.stadium = createStadium(this, tier, data.event);
      this.stadium.scrollTo(0);
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        this.stadium?.destroy();
        this.stadium = null;
      });
    }
    const objs: Phaser.GameObjects.GameObject[] = [addPanel(this, PANEL.x, PANEL.y, PANEL.w, PANEL.h)];
    const text = (y: number, s: string, opts: ConstructorParameters<typeof Label>[4] = {}): Label => {
      const l = new Label(this, 160, PANEL.y + y, s, { align: 'center', depth: D, ...opts });
      objs.push(...l.objects());
      return l;
    };

    let buttons: ButtonRow<ButtonId> | null = null;
    const makeButtons = (
      items: { id: ButtonId; label: string }[],
      initial: ButtonId,
    ): ButtonRow<ButtonId> => {
      const row = new ButtonRow<ButtonId>(this, items, { centerX: 160, y: PANEL.y + 128, gap: 8, initial });
      for (const l of row.labels()) objs.push(...l.objects());
      row.enableTaps(this, (id) => {
        playSfx('menu_select');
        this.choose(id);
      });
      return row;
    };

    switch (data.kind) {
      case 'intro':
        this.buildIntro(text);
        buttons = makeButtons(
          [
            { id: 'start', label: 'START' },
            { id: 'back', label: 'BACK' },
          ],
          'start',
        );
        playMusic('gauntlet', 1);
        break;
      case 'between':
        this.buildBetween(text, objs);
        // A tap anywhere advances at once (32.2).
        registerTapTarget(this, { x: 0, y: 0, w: 320, h: 180 }, () => this.advance());
        this.advanceAt = this.game.loop.time + TUNING.GAUNTLET_NEXT_DELAY_MS;
        duckMusic(true);
        playSfx('win_jingle');
        this.time.delayedCall(JINGLE_MS, () => duckMusic(false));
        break;
      case 'over':
        this.buildOver(text);
        buttons = makeButtons(
          [
            { id: 'newRun', label: 'NEW RUN' },
            { id: 'map', label: 'MAP' },
          ],
          'newRun',
        );
        duckMusic(true);
        playSfx('lose_jingle');
        this.time.delayedCall(JINGLE_MS, () => duckMusic(false));
        break;
      case 'clear':
        this.buildClear(text, objs);
        buttons = makeButtons(
          [
            { id: 'newRun', label: 'NEW RUN' },
            { id: 'map', label: 'MAP' },
          ],
          'newRun',
        );
        playMusic('champion');
        duckMusic(true);
        playSfx('gauntlet_clear');
        this.time.delayedCall(CLEAR_FANFARE_MS, () => duckMusic(false));
        break;
    }

    // Over the race the card slides in like the results card; on its own it is simply there.
    this.card = this.add.container(0, data.overRace ? 180 - PANEL.y : 0, objs).setDepth(UI_DEPTH);
    this.t0 = this.game.loop.time;

    onMenuKeys(this, (action) => {
      if (data.kind === 'between') {
        if (action === 'confirm') this.advance();
        else if (action === 'back') this.openPause();
        return;
      }
      if (!buttons) return;
      switch (action) {
        case 'left':
        case 'right':
          if (buttons.move(action === 'left' ? -1 : 1)) playSfx('menu_move');
          return;
        case 'confirm':
          playSfx('menu_select');
          this.choose(buttons.focusedId ?? (data.kind === 'intro' ? 'start' : 'newRun'));
          return;
        case 'back':
          playSfx('menu_back');
          this.choose(data.kind === 'intro' ? 'back' : 'map');
          return;
        default:
          return;
      }
    });
  }

  private buildIntro(
    text: (y: number, s: string, o?: ConstructorParameters<typeof Label>[4]) => Label,
  ): void {
    const g = getApp().records.gauntlet(this.cardData.event);
    // `GAUNTLET` at 2x with the event under it at 1x: `HURDLES GAUNTLET` at 2x is the panel's full
    // width (M4). Same layout for every event.
    text(8, 'GAUNTLET', { scale: 2, color: PAL.gold });
    text(28, EVENT_TITLE[this.cardData.event]);
    text(44, '7 MEETS. LOSE ONCE', {});
    text(56, 'AND IT ENDS.', {});
    text(74, `BEST ${g.best ? formatLadderTotal(g.best.ms) : '-:--.--'}`, { color: PAL.gold });
    text(88, furthestText(g.furthest));
    text(106, isTouch() ? 'TAP START' : 'ENTER: START   ESC: BACK', {
      font: FONT_MINI,
      color: PAL.lightGrey,
    });
  }

  private buildBetween(
    text: (y: number, s: string, o?: ConstructorParameters<typeof Label>[4]) => Label,
    objs: Phaser.GameObjects.GameObject[],
  ): void {
    const { run, outcome } = this.cardData;
    const won = run.tier - 1;
    text(8, `MEET ${won} WON!`, { scale: 2, color: PAL.gold });
    // Top 3 rows plus the player row (the player is 1st here, so it is among them).
    const rows = (outcome?.standings ?? []).filter((s, i) => i < 3 || s.lane === 0);
    rows.forEach((s, i) => {
      const y = PANEL.y + 32 + i * 16;
      const key = s.who.kind === 'field' ? fieldPortraitKey(s.who.field) : portraitKey(s.who.id, 16);
      objs.push(
        this.add
          .image(PANEL.x + 52, y - 4, key)
          .setOrigin(0, 0)
          .setDepth(D),
      );
      const color = s.lane === 0 ? PAL.gold : s.lane === 1 ? PAL.gold : PAL.lightGrey;
      for (const l of [
        new Label(this, PANEL.x + 24, y + 1, s.place === null ? '' : ordinal(s.place), {
          font: FONT_MINI,
          depth: D,
        }),
        new Label(this, PANEL.x + 72, y, s.name, { color: s.lane === 0 ? PAL.white : color, depth: D }),
        new Label(this, PANEL.x + PANEL.w - 24, y, formatTime(s.ms), { align: 'right', depth: D }),
      ])
        objs.push(...l.objects());
    });
    const time = run.times[run.times.length - 1] ?? null;
    text(84, `TIME ${formatTime(time)}`);
    text(96, `TOTAL ${formatLadderTotal(gauntletTotal(run.times))}`, { color: PAL.gold });
    text(110, `NEXT: ${meet(run.tier).name}`);
    this.countLabel = text(128, '', { font: FONT_MINI, color: PAL.lightGrey });
  }

  private buildOver(text: (y: number, s: string, o?: ConstructorParameters<typeof Label>[4]) => Label): void {
    const { run, outcome, end, quitBefore } = this.cardData;
    const meetName = meet(run.tier).name;
    text(10, 'GAUNTLET OVER', { scale: 2, color: PAL.red });
    text(38, quitBefore === true ? gauntletQuitLine(meetName) : gauntletOutLine(meetName, outcome));
    text(56, `TOTAL ${formatLadderTotal(gauntletTotal(run.times))}`);
    text(70, furthestText(run.times.length));
    const newFurthest = end?.newFurthest === true;
    if (newFurthest) text(88, 'NEW FURTHEST!', { color: PAL.gold });
    if (showBestFurthest(newFurthest)) {
      const best = getApp().records.gauntlet(this.cardData.event).furthest;
      text(90, `BEST ${furthestText(best)}`, { font: FONT_MINI, color: PAL.lightGrey });
    }
  }

  private buildClear(
    text: (y: number, s: string, o?: ConstructorParameters<typeof Label>[4]) => Label,
    objs: Phaser.GameObjects.GameObject[],
  ): void {
    const { run, end } = this.cardData;
    text(8, 'GAUNTLET CLEAR!', { scale: 2, color: PAL.gold });
    // The 7 race times in two mini columns: meets 1-4 left, 5-7 right.
    run.times.forEach((ms, i) => {
      const col = i < 4 ? 0 : 1;
      const row = i < 4 ? i : i - 4;
      const l = new Label(
        this,
        PANEL.x + 40 + col * 100,
        PANEL.y + 32 + row * 10,
        `${i + 1}  ${formatTime(ms)}`,
        { font: FONT_MINI, depth: D },
      );
      objs.push(...l.objects());
    });
    const total = gauntletTotal(run.times);
    text(80, `TOTAL ${formatLadderTotal(total)}`, { color: PAL.gold });
    const best = getApp().records.gauntlet(this.cardData.event).best;
    if (end?.newBest === true) text(96, 'NEW BEST!', { scale: 2, color: PAL.gold });
    else text(100, `BEST ${best ? formatLadderTotal(best.ms) : '-:--.--'}`);
  }

  private choose(id: ButtonId): void {
    if (this.leaving) return;
    const app = getApp();
    const event = this.cardData.event;
    if (id === 'start' || id === 'newRun') {
      this.leaving = true;
      app.gauntlet = newGauntletRun(event);
      playMusic('gauntlet', 1);
      goTo(this, SceneKey.Race, { event, opponent: rivalOfTier(event, 1), mode: 'g' });
      return;
    }
    this.leaving = true;
    app.gauntlet = null;
    if (id === 'map') playMusic('ladder');
    goTo(this, SceneKey.Ladder);
  }

  /** Between-race card: the next race now (Enter, tap or the 3 s timer). */
  private advance(): void {
    if (this.leaving || this.pausedAt !== null) return;
    const run = getApp().gauntlet;
    if (run === null) return;
    this.leaving = true;
    playSfx('menu_select');
    goTo(this, SceneKey.Race, {
      event: run.event,
      opponent: rivalOfTier(run.event, run.tier),
      mode: 'g',
    });
  }

  /** Esc on the between-race card opens the Gauntlet pause menu (32.2). */
  private openPause(): void {
    if (this.leaving || this.pausedAt !== null) return;
    this.pausedAt = this.game.loop.time;
    playSfx('menu_back');
    // Enter means RESUME while the pause menu is up, so the advance line goes (M9).
    this.countLabel?.setVisible(false);
    this.scene.pause();
    const data: PauseData = {
      event: this.cardData.event,
      opponent: rivalOfTier(this.cardData.event, this.cardData.run.tier),
      mode: 'g',
      host: 'gauntlet',
    };
    this.scene.launch(SceneKey.Pause, data);
  }

  /** PauseScene RESUME: the auto-advance timer continues where it stopped. */
  resumeCard(): void {
    if (this.pausedAt === null) return;
    this.advanceAt += this.game.loop.time - this.pausedAt;
    this.pausedAt = null;
    this.countLabel?.setVisible(true);
    this.scene.stop(SceneKey.Pause);
    this.scene.resume();
  }

  /** PauseScene ABANDON RUN on the between-race card: the run ends with the tiers won so far. */
  abandon(): void {
    const app = getApp();
    const run = app.gauntlet;
    app.gauntlet = null;
    this.leaving = true;
    if (run === null) {
      goTo(this, SceneKey.Ladder);
      return;
    }
    const end = app.records.recordGauntletEnd(
      run.event,
      { cleared: false, furthest: run.times.length, times: run.times },
      new Date(),
    );
    const data: GauntletData = {
      kind: 'over',
      event: run.event,
      run,
      outcome: null,
      end,
      overRace: false,
      quitBefore: true,
    };
    this.scene.stop(SceneKey.Pause);
    goTo(this, SceneKey.Gauntlet, data);
  }

  update(time: number): void {
    if (this.cardData.overRace) {
      const t = Math.min(1, (time - this.t0) / SLIDE_MS);
      const eased = 1 - (1 - t) * (1 - t);
      this.card.setY(Math.round((180 - PANEL.y) * (1 - eased)));
    }
    if (this.cardData.kind === 'between' && this.pausedAt === null && !this.leaving) {
      const left = Math.max(0, this.advanceAt - time);
      this.countLabel?.setText(
        isTouch()
          ? `TAP: NEXT RACE  ${Math.ceil(left / 1000)}`
          : `ENTER: NEXT RACE  ${Math.ceil(left / 1000)}`,
      );
      if (left <= 0) this.advance();
    }
  }
}
