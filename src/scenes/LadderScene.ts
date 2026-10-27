import Phaser from 'phaser';
import { formatTime, ladderEntry, OPPONENTS, type OpponentId } from '../core/index.ts';
import {
  createStadium,
  iconKey,
  medalPipKey,
  paletteColor,
  portraitKey,
  type MedalTier,
  type Stadium,
} from '../art/index.ts';
import { playMusic, playSfx, prepareMusic } from '../audio/index.ts';
import { FONT_MINI } from '../ui/fonts.ts';
import { LADDER, ladderNodeY, PAL } from '../ui/hudMath.ts';
import type { MenuAction } from '../ui/keys.ts';
import { MINI_LINE_HEIGHT, wrapMini } from '../ui/miniFont.ts';
import { EVENT_TITLE, ordinal } from '../ui/screenText.ts';
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
  previousOpponent,
  raceMusic,
  restartOnModalityChange,
  SceneKey,
  tierOf,
  visibleLadderIds,
} from './app.ts';
import type { GauntletData } from './GauntletScene.ts';
import type { RevealData } from './RevealScene.ts';

type MenuId = 'back' | 'race' | 'gauntlet' | 'records' | 'options';

// Left ladder panel (4-120, fits VALENTINA); the event name (18.3.2), the rival card and the menu bar
// share the right column (124-316). The v3 menu (RACE, GAUNTLET, RECORDS, OPTIONS; touch adds BACK,
// 17.5.6) needs two lines of 20 px targets in both modalities, so the card keeps 2 flavour lines.
const LADDER_PANEL = { x: 4, y: 8, w: 116, h: 164 } as const;
const EVENT_NAME = { x: 136, y: 4 } as const;
const CARD = { x: 124, y: 14, w: 192, h: 114 } as const;
const BAR = { x: 124, y: 130, w: 192, h: 44 } as const;
const FLAVOUR_LINES = 2;
/** The rope grows to tier 7 over 0.5 s after the reveal (30.2 step 10). */
const GROW_MS = 500;
/** `WIN THE NEON CUP FIRST` shows this long after selecting a locked GAUNTLET (32.1.2). */
const LOCK_NOTE_MS = 2000;

/** S2 Ladder Map for one event (design 6.7, 18.3). */
export class LadderScene extends Phaser.Scene {
  private stadium: Stadium | null = null;
  private stadiumTier = 0;
  private nodes!: Phaser.GameObjects.Graphics;
  private nodePortraits: Phaser.GameObjects.Image[] = [];
  private nodeNames: Label[] = [];
  private cardPortrait!: Phaser.GameObjects.Image;
  private cardTrophy!: Phaser.GameObjects.Image;
  private cardName!: Label;
  private cardTier!: Label;
  private cardWho: Label[] = [];
  private cardTarget!: Label;
  private cardPb!: Label;
  private cardBest!: Label;
  private cardFlavour: Label[] = [];
  private menu!: ButtonRow<MenuId>;
  private pips: Phaser.GameObjects.Image[] = [];
  private flag!: Phaser.GameObjects.Image;
  /** Tier 7 grows in (30.2 step 10): 0 hidden, 1 fully shown. */
  private grow = 1;
  private growT0 = 0;
  private lockNoteUntil = 0;

  constructor() {
    super(SceneKey.Ladder);
  }

  create(): void {
    const app = getApp();
    if (app.championPending !== null) {
      goTo(this, SceneKey.Champion, { event: app.championPending });
      return;
    }
    const event = app.event;
    const rec = app.records;
    // An interrupted reveal plays before the ladder (30.1.5).
    if (rec.revealPending(event)) {
      const data: RevealData = { event, version: rec.revealSeen() ? 'short' : 'full' };
      goTo(this, SceneKey.Reveal, data);
      return;
    }
    // Opening an event's ladder marks it seen and makes it the last event (design 18.3.4).
    rec.markEventSeen(event);
    const justRevealed = app.revealDone === event;
    app.revealDone = null;
    if (justRevealed) app.ladderCursor[event] = ladderIds(event)[6] ?? 'zyx';
    if (!rec.isUnlocked(event, app.ladderCursor[event])) app.ladderCursor[event] = 'pip';
    this.grow = justRevealed ? 0 : 1;
    this.growT0 = this.game.loop.time;
    this.lockNoteUntil = 0;
    this.pips = [];
    this.cameras.main.setBackgroundColor(paletteColor(PAL.ink));
    applyCrt(this);
    this.nodePortraits = [];
    this.nodeNames = [];
    this.cardWho = [];
    this.cardFlavour = [];
    this.stadiumTier = 0;
    const touch = isTouch();
    const card = CARD;
    const bar = BAR;

    const panels = this.add.graphics().setDepth(UI_DEPTH);
    drawPanel(panels, LADDER_PANEL.x, LADDER_PANEL.y, LADDER_PANEL.w, LADDER_PANEL.h);
    drawPanel(panels, card.x, card.y, card.w, card.h);
    drawPanel(panels, bar.x, bar.y, bar.w, bar.h);
    this.nodes = this.add.graphics().setDepth(UI_DEPTH + 1);
    new Label(this, EVENT_NAME.x, EVENT_NAME.y - 1, EVENT_TITLE[event], {
      color: PAL.gold,
      outline: true,
      depth: UI_DEPTH + 2,
    });

    const ids = ladderIds(event);
    ids.forEach((id, i) => {
      const cy = ladderNodeY(i + 1);
      this.nodePortraits.push(
        this.add
          .image(LADDER.ropeX - 8, cy - 8, portraitKey(id, 16, !rec.isUnlocked(event, id)))
          .setOrigin(0, 0)
          .setDepth(UI_DEPTH + 2),
      );
      this.nodeNames.push(new Label(this, 42, cy - 4, '', { depth: UI_DEPTH + 2 }));
      // Best placing pip (29.1.1) on the frame's top-right corner.
      this.pips.push(
        this.add
          .image(LADDER.ropeX + LADDER.nodeSize / 2 - 3, cy - LADDER.nodeSize / 2 - 2, medalPipKey(1))
          .setOrigin(0, 0)
          .setDepth(UI_DEPTH + 3)
          .setVisible(false),
      );
      // Ladder node as a list item (17.5.3): first tap selects, a tap on the selected rival races.
      registerTapTarget(
        this,
        { x: LADDER_PANEL.x, y: cy - LADDER.spacing / 2, w: LADDER_PANEL.w, h: LADDER.spacing },
        () => this.tapNode(id),
      );
    });
    // Before the reveal the rope ends at tier 6 under a finish flag (29.1.3).
    this.flag = this.add
      .image(LADDER.ropeX - 4, ladderNodeY(6) - LADDER.nodeSize / 2 - 12, iconKey('finishFlagSmall'))
      .setOrigin(0, 0)
      .setDepth(UI_DEPTH + 2);

    this.cardPortrait = this.add
      .image(card.x + 8, card.y + 8, portraitKey('pip', 48))
      .setOrigin(0, 0)
      .setDepth(UI_DEPTH + 2);
    this.cardTrophy = this.add
      .image(card.x + card.w - 22, card.y + 58, iconKey('trophy'))
      .setOrigin(0, 0)
      .setDepth(UI_DEPTH + 2);
    const tx = card.x + 62;
    this.cardName = new Label(this, tx, card.y + 10, '', { color: PAL.gold });
    this.cardTier = new Label(this, tx, card.y + 22, '');
    for (let i = 0; i < 2; i++) {
      this.cardWho.push(
        new Label(this, tx, card.y + 36 + i * MINI_LINE_HEIGHT, '', {
          font: FONT_MINI,
          color: PAL.lightGrey,
        }),
      );
    }
    this.cardTarget = new Label(this, card.x + 8, card.y + 60, '');
    this.cardPb = new Label(this, card.x + 8, card.y + 71, '');
    this.cardBest = new Label(this, card.x + 8, card.y + 82, '');
    for (let i = 0; i < FLAVOUR_LINES; i++) {
      this.cardFlavour.push(
        new Label(this, card.x + 8, card.y + 94 + i * (MINI_LINE_HEIGHT + 1), '', {
          font: FONT_MINI,
          color: PAL.lightGrey,
        }),
      );
    }

    this.menu = new ButtonRow<MenuId>(
      this,
      [
        ...(touch ? [{ id: 'back' as const, label: 'BACK' }] : []),
        { id: 'race', label: 'RACE' },
        { id: 'gauntlet', label: 'GAUNTLET' },
        { id: 'records', label: 'RECORDS' },
        { id: 'options', label: 'OPTIONS' },
      ],
      {
        centerX: bar.x + bar.w / 2,
        y: bar.y + 8,
        gap: 0,
        initial: 'race',
        perLine: touch ? 3 : 2,
        lineStep: 20,
      },
    );
    this.menu.enableTaps(this, (id) => this.confirm(id));

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.stadium?.destroy();
      this.stadium = null;
    });

    this.refresh();
    playMusic('ladder');
    if (rec.isGauntletUnlocked(event)) void prepareMusic('gauntlet', 1);
    if (justRevealed) playSfx('unlock');
    restartOnModalityChange(this);
    onMenuKeys(this, (action) => this.onAction(action));
  }

  private tapNode(id: OpponentId): void {
    const app = getApp();
    if (!visibleLadderIds(app.records, app.event).includes(id)) return;
    if (app.ladderCursor[app.event] === id) {
      this.confirm('race');
      return;
    }
    app.ladderCursor[app.event] = id;
    playSfx('menu_move');
    this.refresh();
  }

  private onAction(action: MenuAction): void {
    const app = getApp();
    switch (action) {
      case 'up':
      case 'down': {
        const ids = visibleLadderIds(app.records, app.event);
        const i = ids.indexOf(app.ladderCursor[app.event]) + (action === 'up' ? 1 : -1);
        const next = ids[i];
        if (next) {
          app.ladderCursor[app.event] = next;
          playSfx('menu_move');
          this.refresh();
        }
        return;
      }
      case 'left':
      case 'right':
        if (this.menu.move(action === 'left' ? -1 : 1)) playSfx('menu_move');
        return;
      case 'confirm':
        this.confirm(this.menu.focusedId ?? 'race');
        return;
      case 'back':
        playSfx('menu_back');
        goTo(this, SceneKey.Events);
        return;
      default:
        return;
    }
  }

  private confirm(id: MenuId): void {
    const app = getApp();
    const event = app.event;
    switch (id) {
      case 'back':
        playSfx('menu_back');
        goTo(this, SceneKey.Events);
        return;
      case 'race':
        if (!app.records.isUnlocked(event, app.ladderCursor[event])) {
          playSfx('menu_back');
          return;
        }
        playSfx('menu_select');
        goTo(this, SceneKey.Race, { event, opponent: app.ladderCursor[event] });
        return;
      case 'gauntlet': {
        // Locked until the reveal; no spoiler in the note (32.1.2).
        if (!app.records.isGauntletUnlocked(event)) {
          playSfx('menu_back');
          this.lockNoteUntil = this.game.loop.time + LOCK_NOTE_MS;
          this.refresh();
          return;
        }
        playSfx('menu_select');
        const data: GauntletData = {
          kind: 'intro',
          event,
          run: { event, tier: 1, times: [] },
          outcome: null,
          end: null,
          overRace: false,
        };
        goTo(this, SceneKey.Gauntlet, data);
        return;
      }
      case 'records':
        playSfx('menu_select');
        goTo(this, SceneKey.Records, { event, from: SceneKey.Ladder });
        return;
      case 'options':
        playSfx('menu_select');
        goTo(this, SceneKey.Options, { from: SceneKey.Ladder });
        return;
    }
  }

  private refresh(): void {
    const app = getApp();
    const rec = app.records;
    const event = app.event;
    const sel = app.ladderCursor[event];
    const info = OPPONENTS[sel];
    const entry = ladderEntry(event, sel);
    const tier = tierOf(event, sel);
    const unlocked = rec.isUnlocked(event, sel);
    const card = CARD;

    // Render the race track for the highlighted rival in the background (audio's optional API).
    if (unlocked) {
      const music = raceMusic(event, sel);
      void prepareMusic(music.id, music.tier);
    }

    if (this.stadiumTier !== tier) {
      this.stadium?.destroy();
      this.stadium = createStadium(this, tier, event);
      this.stadium.scrollTo(0);
      this.stadiumTier = tier;
    }

    // Ladder: rope, node frames, best placing pips, names. Tier 7 is not drawn before the reveal
    // (29.1.3) and grows in right after it (30.2 step 10).
    const ids = ladderIds(event);
    const revealed = rec.isRevealed(event);
    const shownTiers = revealed && this.grow >= 1 ? ids.length : ids.length - 1;
    const g = this.nodes;
    g.clear();
    const bottom = ladderNodeY(1);
    const top6 = ladderNodeY(ids.length - 1);
    const ropeTop = revealed ? Math.round(top6 - Math.min(1, this.grow) * LADDER.spacing) : top6;
    fillRect(g, LADDER.ropeX - 1, ropeTop, 2, bottom - ropeTop, PAL.lightGrey);
    this.flag.setVisible(!revealed);
    ids.forEach((id, i) => {
      const shown = i < shownTiers;
      this.nodePortraits[i]?.setVisible(shown);
      this.nodeNames[i]?.setVisible(shown);
      const pip = this.pips[i];
      if (!shown) {
        pip?.setVisible(false);
        return;
      }
      const cy = ladderNodeY(i + 1);
      const fx = LADDER.ropeX - LADDER.nodeSize / 2;
      const fy = cy - LADDER.nodeSize / 2;
      const isSel = id === sel;
      const isUnlocked = rec.isUnlocked(event, id);
      drawPanel(
        g,
        fx,
        fy,
        LADDER.nodeSize,
        LADDER.nodeSize,
        isSel ? PAL.gold : isUnlocked ? PAL.white : PAL.grey,
      );
      // Medal pip of the best placing: gold 1, silver 2, bronze 3; none for 4th-6th (29.1.1).
      const place = rec.bestPlace(event, id);
      if (pip) {
        if (place !== null && place <= 3) pip.setTexture(medalPipKey(place as MedalTier)).setVisible(true);
        else pip.setVisible(false);
      }
      this.nodePortraits[i]?.setTexture(portraitKey(id, 16, !isUnlocked));
      this.nodeNames[i]
        ?.setText(isUnlocked ? OPPONENTS[id].name : '???')
        .setColor(isSel ? PAL.gold : isUnlocked ? PAL.white : PAL.grey);
    });

    // Rival card: that event's target, PB and flavour (18.3.3), times per 14.4.
    this.cardPortrait.setTexture(portraitKey(sel, 48, !unlocked));
    this.cardName.setText(unlocked ? info.name : '???').setColor(unlocked ? PAL.gold : PAL.grey);
    this.cardTier.setText(`TIER ${tier}`);
    const who = unlocked ? wrapMini(info.who, card.w - 70) : [];
    this.cardWho.forEach((l, i) => l.setText(who[i] ?? ''));
    // Press Start 2P is monospaced, so padding lines the two values up in one column.
    this.cardTarget.setText(`TARGET ${formatTime(entry?.targetMs ?? null)}`);
    this.cardPb.setText(`PB     ${formatTime(rec.bestMs(event, sel))}`);
    const best = rec.bestPlace(event, sel);
    this.cardBest.setText(`BEST   ${best === null ? '--' : ordinal(best)}`);
    this.cardTrophy.setVisible(rec.isBeaten(event, sel));
    const prev = previousOpponent(event, sel);
    const note = this.game.loop.time < this.lockNoteUntil;
    const flavour = note
      ? 'WIN THE NEON CUP FIRST'
      : unlocked
        ? (entry?.flavour ?? '')
        : `Beat ${prev ? OPPONENTS[prev].name : ''} to unlock`;
    const lines = wrapMini(flavour, card.w - 16);
    this.cardFlavour.forEach((l, i) => l.setText(lines[i] ?? '').setColor(note ? PAL.gold : PAL.lightGrey));

    // RACE stays focusable but is drawn grey (and does nothing) for a locked rival; GAUNTLET is
    // dimmed until the reveal (29.1.5).
    this.menu.setDimmed('race', !unlocked);
    this.menu.setDimmed('gauntlet', !rec.isGauntletUnlocked(event));
  }

  update(time: number): void {
    if (this.grow < 1) {
      this.grow = Math.min(1, (time - this.growT0) / GROW_MS);
      this.refresh();
    }
    if (this.lockNoteUntil > 0 && time >= this.lockNoteUntil) {
      this.lockNoteUntil = 0;
      this.refresh();
    }
  }
}
