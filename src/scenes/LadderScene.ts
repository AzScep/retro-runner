import Phaser from 'phaser';
import { formatTime, OPPONENT_IDS, OPPONENTS } from '../core/index.ts';
import { createStadium, iconKey, paletteColor, portraitKey, type Stadium } from '../art/index.ts';
import { playMusic, playSfx, prepareMusic } from '../audio/index.ts';
import { FONT_MINI } from '../ui/fonts.ts';
import { LADDER, ladderNodeY, PAL } from '../ui/hudMath.ts';
import { MINI_LINE_HEIGHT, wrapMini } from '../ui/miniFont.ts';
import { Label } from '../ui/text.ts';
import { ButtonRow, drawPanel, fillRect, UI_DEPTH } from '../ui/widgets.ts';
import { applyCrt, getApp, goTo, onMenuKeys, previousOpponent, SceneKey } from './app.ts';

type MenuId = 'race' | 'records' | 'options';

// Left ladder panel (4-120, fits VALENTINA at 2x); the rival card and the menu bar share the right
// column (124-316). 4 px screen margins and gutters everywhere, and the menu row sits on its own
// panel so it stays readable (also when RACE is dimmed) over any stadium.
const LADDER_PANEL = { x: 4, y: 8, w: 116, h: 164 } as const;
const CARD = { x: 124, y: 8, w: 192, h: 136 } as const;
const MENU_BAR = { x: 124, y: 148, w: 192, h: 24 } as const;
const FLAVOUR_LINES = 3;

/** S2 Ladder Map (design 1.2, 6.7). */
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

  constructor() {
    super(SceneKey.Ladder);
  }

  create(): void {
    const app = getApp();
    if (app.championPending) {
      goTo(this, SceneKey.Champion);
      return;
    }
    if (!app.records.isUnlocked(app.ladderCursor)) app.ladderCursor = 'pip';
    this.cameras.main.setBackgroundColor(paletteColor(PAL.ink));
    applyCrt(this);
    this.nodePortraits = [];
    this.nodeNames = [];
    this.cardWho = [];
    this.cardFlavour = [];
    this.stadiumTier = 0;

    const panels = this.add.graphics().setDepth(UI_DEPTH);
    drawPanel(panels, LADDER_PANEL.x, LADDER_PANEL.y, LADDER_PANEL.w, LADDER_PANEL.h);
    drawPanel(panels, CARD.x, CARD.y, CARD.w, CARD.h);
    drawPanel(panels, MENU_BAR.x, MENU_BAR.y, MENU_BAR.w, MENU_BAR.h);
    this.nodes = this.add.graphics().setDepth(UI_DEPTH + 1);

    for (const id of OPPONENT_IDS) {
      const tier = OPPONENTS[id].tier;
      const cy = ladderNodeY(tier);
      this.nodePortraits.push(
        this.add
          .image(LADDER.ropeX - 8, cy - 8, portraitKey(id, 16, !app.records.isUnlocked(id)))
          .setOrigin(0, 0)
          .setDepth(UI_DEPTH + 2),
      );
      this.nodeNames.push(new Label(this, 42, cy - 4, '', { depth: UI_DEPTH + 2 }));
    }

    this.cardPortrait = this.add
      .image(CARD.x + 8, CARD.y + 8, portraitKey('pip', 48))
      .setOrigin(0, 0)
      .setDepth(UI_DEPTH + 2);
    this.cardTrophy = this.add
      .image(CARD.x + CARD.w - 22, CARD.y + 62, iconKey('trophy'))
      .setOrigin(0, 0)
      .setDepth(UI_DEPTH + 2);
    const tx = CARD.x + 62;
    this.cardName = new Label(this, tx, CARD.y + 10, '', { color: PAL.gold });
    this.cardTier = new Label(this, tx, CARD.y + 22, '');
    for (let i = 0; i < 2; i++) {
      this.cardWho.push(
        new Label(this, tx, CARD.y + 36 + i * MINI_LINE_HEIGHT, '', {
          font: FONT_MINI,
          color: PAL.lightGrey,
        }),
      );
    }
    this.cardTarget = new Label(this, CARD.x + 8, CARD.y + 64, '');
    this.cardPb = new Label(this, CARD.x + 8, CARD.y + 76, '');
    for (let i = 0; i < FLAVOUR_LINES; i++) {
      this.cardFlavour.push(
        new Label(this, CARD.x + 8, CARD.y + 94 + i * (MINI_LINE_HEIGHT + 2), '', {
          font: FONT_MINI,
          color: PAL.lightGrey,
        }),
      );
    }

    this.menu = new ButtonRow<MenuId>(
      this,
      [
        { id: 'race', label: 'RACE' },
        { id: 'records', label: 'RECORDS' },
        { id: 'options', label: 'OPTIONS' },
      ],
      { centerX: MENU_BAR.x + MENU_BAR.w / 2, y: MENU_BAR.y + 8, gap: -4, initial: 'race' },
    );

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.stadium?.destroy();
      this.stadium = null;
    });

    this.refresh();
    playMusic('ladder');
    onMenuKeys(this, (action) => this.onAction(action));
  }

  private onAction(action: string): void {
    const app = getApp();
    switch (action) {
      case 'up':
      case 'down': {
        const i = OPPONENT_IDS.indexOf(app.ladderCursor) + (action === 'up' ? 1 : -1);
        const next = OPPONENT_IDS[i];
        if (next) {
          app.ladderCursor = next;
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
        this.confirm();
        return;
      case 'back':
        playSfx('menu_back');
        goTo(this, SceneKey.Title);
        return;
      default:
        return;
    }
  }

  private confirm(): void {
    const app = getApp();
    switch (this.menu.focusedId) {
      case 'race':
        if (!app.records.isUnlocked(app.ladderCursor)) {
          playSfx('menu_back');
          return;
        }
        playSfx('menu_select');
        goTo(this, SceneKey.Race, { opponent: app.ladderCursor });
        return;
      case 'records':
        playSfx('menu_select');
        goTo(this, SceneKey.Records);
        return;
      case 'options':
        playSfx('menu_select');
        goTo(this, SceneKey.Options);
        return;
      default:
        return;
    }
  }

  private refresh(): void {
    const app = getApp();
    const rec = app.records;
    const sel = app.ladderCursor;
    const info = OPPONENTS[sel];
    const unlocked = rec.isUnlocked(sel);

    // Render the race track for the highlighted rival in the background (audio's optional API).
    if (unlocked) void prepareMusic(info.tier === 7 ? 'boss' : 'race', info.tier);

    if (this.stadiumTier !== info.tier) {
      this.stadium?.destroy();
      this.stadium = createStadium(this, info.tier);
      this.stadium.scrollTo(0);
      this.stadiumTier = info.tier;
    }

    // Ladder: rope, node frames, trophy pips, names.
    const g = this.nodes;
    g.clear();
    const top = ladderNodeY(OPPONENT_IDS.length);
    const bottom = ladderNodeY(1);
    fillRect(g, LADDER.ropeX - 1, top, 2, bottom - top, PAL.lightGrey);
    OPPONENT_IDS.forEach((id, i) => {
      const cy = ladderNodeY(OPPONENTS[id].tier);
      const fx = LADDER.ropeX - LADDER.nodeSize / 2;
      const fy = cy - LADDER.nodeSize / 2;
      const isSel = id === sel;
      const isUnlocked = rec.isUnlocked(id);
      drawPanel(
        g,
        fx,
        fy,
        LADDER.nodeSize,
        LADDER.nodeSize,
        isSel ? PAL.gold : isUnlocked ? PAL.white : PAL.grey,
      );
      if (rec.isBeaten(id)) {
        // Trophy pip: 4x4 gold square with ink outline on the frame's top-right corner.
        fillRect(g, fx + LADDER.nodeSize - 4, fy - 2, 6, 6, PAL.ink);
        fillRect(g, fx + LADDER.nodeSize - 3, fy - 1, 4, 4, PAL.gold);
      }
      this.nodePortraits[i]?.setTexture(portraitKey(id, 16, !isUnlocked));
      this.nodeNames[i]
        ?.setText(isUnlocked ? OPPONENTS[id].name : '???')
        .setColor(isSel ? PAL.gold : isUnlocked ? PAL.white : PAL.grey);
    });

    // Rival card.
    this.cardPortrait.setTexture(portraitKey(sel, 48, !unlocked));
    this.cardName.setText(unlocked ? info.name : '???').setColor(unlocked ? PAL.gold : PAL.grey);
    this.cardTier.setText(`TIER ${info.tier}`);
    const who = unlocked ? wrapMini(info.who, CARD.w - 70) : [];
    this.cardWho.forEach((l, i) => l.setText(who[i] ?? ''));
    // Press Start 2P is monospaced, so padding lines the two values up in one column.
    this.cardTarget.setText(`TARGET ${formatTime(info.targetMs)}`);
    this.cardPb.setText(`PB     ${formatTime(rec.bestMs(sel))}`);
    this.cardTrophy.setVisible(rec.isBeaten(sel));
    const prev = previousOpponent(sel);
    const flavour = unlocked ? info.flavour : `Beat ${prev ? OPPONENTS[prev].name : ''} to unlock`;
    const lines = wrapMini(flavour, CARD.w - 16);
    this.cardFlavour.forEach((l, i) => l.setText(lines[i] ?? ''));

    // RACE stays focusable but is drawn grey (and does nothing) for a locked rival.
    this.menu.setDimmed('race', !unlocked);
  }
}
