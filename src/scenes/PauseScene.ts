import Phaser from 'phaser';
import { raceFeed, type EventId, type OpponentId, type RaceMode } from '../core/index.ts';
import { playSfx } from '../audio/index.ts';
import { PAL } from '../ui/hudMath.ts';
import { Label } from '../ui/text.ts';
import { addPanel, MenuList } from '../ui/widgets.ts';
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
 * Layouts: keyboard 14 px rows; touch 20 px rows so each item is a 20 px tap target (17.5).
 * Content (cursor to the end of QUIT TO MAP) is 98 px wide, centred in the panel with 8 px of
 * padding above PAUSED and below the last item.
 */
const LAYOUT = {
  keyboard: { panelY: 52, panelH: 70, listY: 78, lineHeight: 14 },
  touch: { panelY: 44, panelH: 86, listY: 72, lineHeight: 20 },
} as const;
/** Gauntlet: two items, so the panel loses one row. */
const LAYOUT_G = {
  keyboard: { panelY: 59, panelH: 56, listY: 85, lineHeight: 14 },
  touch: { panelY: 54, panelH: 66, listY: 82, lineHeight: 20 },
} as const;

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
      goTo(this, SceneKey.Race, { event: this.pauseData.event, opponent: this.pauseData.opponent });
    else goTo(this, SceneKey.Ladder);
  }
}
