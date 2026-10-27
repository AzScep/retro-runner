import Phaser from 'phaser';
import { formatTime, ladderEntry, OPPONENTS, type OpponentId } from '../core/index.ts';
import { createStadium, iconKey, paletteColor, portraitKey, type Stadium } from '../art/index.ts';
import { playMusic, playSfx, prepareMusic } from '../audio/index.ts';
import { FONT_MINI } from '../ui/fonts.ts';
import { LADDER, ladderNodeY, PAL } from '../ui/hudMath.ts';
import type { MenuAction } from '../ui/keys.ts';
import { MINI_LINE_HEIGHT, wrapMini } from '../ui/miniFont.ts';
import { EVENT_TITLE } from '../ui/screenText.ts';
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
} from './app.ts';

type MenuId = 'back' | 'race' | 'records' | 'options';

// Left ladder panel (4-120, fits VALENTINA); the event name (18.3.2), the rival card and the menu bar
// share the right column (124-316). On touch the menu gains BACK (17.5.6) and wraps into two lines of
// 20 px tap targets, so the card gives up its third flavour line.
const LADDER_PANEL = { x: 4, y: 8, w: 116, h: 164 } as const;
const EVENT_NAME = { x: 136, y: 4 } as const;
const LAYOUT = {
  keyboard: {
    card: { x: 124, y: 14, w: 192, h: 130 },
    bar: { x: 124, y: 148, w: 192, h: 24 },
    flavourLines: 3,
  },
  touch: {
    card: { x: 124, y: 14, w: 192, h: 114 },
    bar: { x: 124, y: 130, w: 192, h: 44 },
    flavourLines: 2,
  },
} as const;

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
  private cardFlavour: Label[] = [];
  private menu!: ButtonRow<MenuId>;
  private card: { readonly x: number; readonly y: number; readonly w: number; readonly h: number } =
    LAYOUT.keyboard.card;

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
    // Opening an event's ladder marks it seen and makes it the last event (design 18.3.4).
    rec.markEventSeen(event);
    if (!rec.isUnlocked(event, app.ladderCursor[event])) app.ladderCursor[event] = 'pip';
    this.cameras.main.setBackgroundColor(paletteColor(PAL.ink));
    applyCrt(this);
    this.nodePortraits = [];
    this.nodeNames = [];
    this.cardWho = [];
    this.cardFlavour = [];
    this.stadiumTier = 0;
    const touch = isTouch();
    const layout = touch ? LAYOUT.touch : LAYOUT.keyboard;
    const card = layout.card;
    const bar = layout.bar;
    this.card = card;

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
      // Ladder node as a list item (17.5.3): first tap selects, a tap on the selected rival races.
      registerTapTarget(
        this,
        { x: LADDER_PANEL.x, y: cy - LADDER.spacing / 2, w: LADDER_PANEL.w, h: LADDER.spacing },
        () => this.tapNode(id),
      );
    });

    this.cardPortrait = this.add
      .image(card.x + 8, card.y + 8, portraitKey('pip', 48))
      .setOrigin(0, 0)
      .setDepth(UI_DEPTH + 2);
    this.cardTrophy = this.add
      .image(card.x + card.w - 22, card.y + 62, iconKey('trophy'))
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
    this.cardTarget = new Label(this, card.x + 8, card.y + 64, '');
    this.cardPb = new Label(this, card.x + 8, card.y + 76, '');
    for (let i = 0; i < layout.flavourLines; i++) {
      this.cardFlavour.push(
        new Label(this, card.x + 8, card.y + 94 + i * (MINI_LINE_HEIGHT + 2), '', {
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
        { id: 'records', label: 'RECORDS' },
        { id: 'options', label: 'OPTIONS' },
      ],
      touch
        ? { centerX: bar.x + bar.w / 2, y: bar.y + 8, gap: 0, initial: 'race', perLine: 2, lineStep: 20 }
        : { centerX: bar.x + bar.w / 2, y: bar.y + 8, gap: -4, initial: 'race' },
    );
    this.menu.enableTaps(this, (id) => this.confirm(id));

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.stadium?.destroy();
      this.stadium = null;
    });

    this.refresh();
    playMusic('ladder');
    restartOnModalityChange(this);
    onMenuKeys(this, (action) => this.onAction(action));
  }

  private tapNode(id: OpponentId): void {
    const app = getApp();
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
        const ids = ladderIds(app.event);
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
    const card = this.card;

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

    // Ladder: rope, node frames, trophy pips, names.
    const ids = ladderIds(event);
    const g = this.nodes;
    g.clear();
    const top = ladderNodeY(ids.length);
    const bottom = ladderNodeY(1);
    fillRect(g, LADDER.ropeX - 1, top, 2, bottom - top, PAL.lightGrey);
    ids.forEach((id, i) => {
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
      if (rec.isBeaten(event, id)) {
        // Trophy pip: 4x4 gold square with ink outline on the frame's top-right corner.
        fillRect(g, fx + LADDER.nodeSize - 4, fy - 2, 6, 6, PAL.ink);
        fillRect(g, fx + LADDER.nodeSize - 3, fy - 1, 4, 4, PAL.gold);
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
    this.cardTrophy.setVisible(rec.isBeaten(event, sel));
    const prev = previousOpponent(event, sel);
    const flavour = unlocked ? (entry?.flavour ?? '') : `Beat ${prev ? OPPONENTS[prev].name : ''} to unlock`;
    const lines = wrapMini(flavour, card.w - 16);
    this.cardFlavour.forEach((l, i) => l.setText(lines[i] ?? ''));

    // RACE stays focusable but is drawn grey (and does nothing) for a locked rival.
    this.menu.setDimmed('race', !unlocked);
  }
}
