import Phaser from 'phaser';
import { raceFeed, type EventId, type OpponentId } from '../core/index.ts';
import { playSfx } from '../audio/index.ts';
import { PAL } from '../ui/hudMath.ts';
import { Label } from '../ui/text.ts';
import { addPanel, MenuList } from '../ui/widgets.ts';
import { applyCrt, goTo, isTouch, onMenuKeys, restartOnModalityChange, SceneKey } from './app.ts';
import type { RaceScene } from './RaceScene.ts';

type PauseId = 'resume' | 'restart' | 'quit';

export interface PauseData {
  readonly event: EventId;
  readonly opponent: OpponentId;
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

/** S8 Pause overlay: RESUME, RESTART, QUIT TO MAP. Esc (or the touch pause button) resumes. */
export class PauseScene extends Phaser.Scene {
  private pauseData!: PauseData;

  constructor() {
    super(SceneKey.Pause);
  }

  create(data: PauseData): void {
    this.pauseData = data;
    applyCrt(this);
    const layout = isTouch() ? LAYOUT.touch : LAYOUT.keyboard;
    addPanel(this, 88, layout.panelY, 144, layout.panelH);
    new Label(this, 160, layout.panelY + 8, 'PAUSED', { align: 'center', color: PAL.gold, depth: 101 });
    const menu = new MenuList<PauseId>(
      this,
      [
        { id: 'resume', label: 'RESUME' },
        { id: 'restart', label: 'RESTART' },
        { id: 'quit', label: 'QUIT TO MAP' },
      ],
      { x: 111, y: layout.listY, lineHeight: layout.lineHeight },
    );
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
          this.race().resumeRace();
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
    const race = this.race();
    if (race.isPaused) raceFeed.publish(race.raceState, []);
  }

  private race(): RaceScene {
    return this.scene.get(SceneKey.Race) as RaceScene;
  }

  private choose(id: PauseId): void {
    if (id === 'resume') this.race().resumeRace();
    // Restarting creates a new Race, which resets the false start count (design 2.5.5).
    else if (id === 'restart')
      goTo(this, SceneKey.Race, { event: this.pauseData.event, opponent: this.pauseData.opponent });
    else goTo(this, SceneKey.Ladder);
  }
}
