import Phaser from 'phaser';
import { raceFeed, type EventId, type OpponentId, type RaceMode } from '../core/index.ts';
import { GAME_HEIGHT, GAME_WIDTH, paletteColor } from '../art/index.ts';
import { playSfx } from '../audio/index.ts';
import { PAL } from '../ui/hudMath.ts';
import { Label } from '../ui/text.ts';
import { addPanel, MenuList, UI_DEPTH } from '../ui/widgets.ts';
import { applyCrt, goTo, isTouch, onMenuKeys, restartOnModalityChange, SceneKey } from './app.ts';
import type { GauntletScene } from './GauntletScene.ts';
import type { RaceScene } from './RaceScene.ts';

type PauseId = 'resume' | 'restart' | 'quit' | 'abandon';

export interface PauseData {
  readonly event: EventId;
  readonly opponent: OpponentId;
  /** Gauntlet (32.4): RESUME and ABANDON RUN only. */
  readonly mode?: RaceMode;
  /** Who paused: the race (default) or the Gauntlet between-race card. */
  readonly host?: 'race' | 'gauntlet';
}

/**
 * Layouts: keyboard 14 px rows; touch MENU_TAP_MIN (24) px rows so each item is a 44 CSS px tap
 * target on phones (17.5). Content (cursor to the end of QUIT TO MAP) is 98 px wide, centred in the
 * panel with 8 px of padding above PAUSED and below the last item (touch: below its tap row).
 */
const LAYOUT = {
  keyboard: { panelY: 52, panelH: 70, listY: 78, lineHeight: 14 },
  touch: { panelY: 38, panelH: 104, listY: 70, lineHeight: 24 },
} as const;
/** Gauntlet: two items, so the panel loses one row. */
const LAYOUT_G = {
  keyboard: { panelY: 59, panelH: 56, listY: 85, lineHeight: 14 },
  touch: { panelY: 50, panelH: 80, listY: 82, lineHeight: 24 },
} as const;

/** Full-screen 1 px checker of index 1 (ink): dims what is behind without semi-transparency (5.2). */
const BACKDROP_KEY = 'ui.pause.backdrop';

function ensureBackdrop(scene: Phaser.Scene): string {
  const textures = scene.sys.textures;
  if (textures.exists(BACKDROP_KEY)) return BACKDROP_KEY;
  const tex = textures.createCanvas(BACKDROP_KEY, GAME_WIDTH, GAME_HEIGHT);
  if (!tex) return BACKDROP_KEY;
  const ctx = tex.getContext();
  ctx.fillStyle = `#${paletteColor(PAL.ink).toString(16).padStart(6, '0')}`;
  for (let y = 0; y < GAME_HEIGHT; y++) {
    for (let x = y % 2; x < GAME_WIDTH; x += 2) ctx.fillRect(x, y, 1, 1);
  }
  tex.refresh();
  return BACKDROP_KEY;
}

/** S8 Pause overlay: RESUME, RESTART, QUIT TO MAP. Esc (or the touch pause button) resumes. */
export class PauseScene extends Phaser.Scene {
  private pauseData!: PauseData;

  constructor() {
    super(SceneKey.Pause);
  }

  create(data: PauseData): void {
    this.pauseData = data;
    applyCrt(this);
    const gauntlet = data.mode === 'g';
    const layouts = gauntlet ? LAYOUT_G : LAYOUT;
    const layout = isTouch() ? layouts.touch : layouts.keyboard;
    // Behind the panel, half the pixels of whatever is paused go dark, so the menu reads as on top.
    this.add
      .image(0, 0, ensureBackdrop(this))
      .setOrigin(0, 0)
      .setDepth(UI_DEPTH - 1);
    addPanel(this, 88, layout.panelY, 144, layout.panelH);
    new Label(this, 160, layout.panelY + 8, 'PAUSED', { align: 'center', color: PAL.gold, depth: 101 });
    const items: { id: PauseId; label: string }[] = gauntlet
      ? [
          { id: 'resume', label: 'RESUME' },
          { id: 'abandon', label: 'ABANDON RUN' },
        ]
      : [
          { id: 'resume', label: 'RESUME' },
          { id: 'restart', label: 'RESTART' },
          { id: 'quit', label: 'QUIT TO MAP' },
        ];
    const menu = new MenuList<PauseId>(this, items, {
      x: 111,
      y: layout.listY,
      lineHeight: layout.lineHeight,
    });
    // Buttons confirm on one tap (17.5.4).
    menu.enableTaps(this, 136, (id) => {
      playSfx('menu_select');
      this.choose(id);
    });
    restartOnModalityChange(this, data);
    onMenuKeys(this, (action) => {
      switch (action) {
        case 'up':
        case 'down':
          if (menu.move(action === 'up' ? -1 : 1)) playSfx('menu_move');
          return;
        case 'back':
          playSfx('menu_back');
          this.choose('resume');
          return;
        case 'confirm':
          playSfx('menu_select');
          this.choose(menu.focusedId ?? 'resume');
          return;
        default:
          return;
      }
    });
  }

  /**
   * RaceScene's update stops while it is paused, so the overlay keeps the feed alive: touch and
   * haptics read `paused: true` from every frame instead of tracking pause themselves.
   */
  update(): void {
    if (this.pauseData.host === 'gauntlet') return;
    const race = this.race();
    if (race.isPaused) raceFeed.publish(race.raceState, []);
  }

  private race(): RaceScene {
    return this.scene.get(SceneKey.Race) as RaceScene;
  }

  private card(): GauntletScene {
    return this.scene.get(SceneKey.Gauntlet) as GauntletScene;
  }

  private choose(id: PauseId): void {
    const onCard = this.pauseData.host === 'gauntlet';
    if (id === 'resume') {
      if (onCard) this.card().resumeCard();
      else this.race().resumeRace();
    } else if (id === 'abandon') {
      if (onCard) this.card().abandon();
      else this.race().abandonRun();
    }
    // Restarting creates a new Race, which resets the false start count (design 2.5.5).
    else if (id === 'restart')
      goTo(this, SceneKey.Race, {
        event: this.pauseData.event,
        opponent: this.pauseData.opponent,
        retry: true,
      });
    else goTo(this, SceneKey.Ladder);
  }
}
