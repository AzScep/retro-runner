import Phaser from 'phaser';
import type { OpponentId } from '../core/index.ts';
import { playSfx } from '../audio/index.ts';
import { PAL } from '../ui/hudMath.ts';
import { Label } from '../ui/text.ts';
import { addPanel, MenuList } from '../ui/widgets.ts';
import { applyCrt, goTo, onMenuKeys, SceneKey } from './app.ts';
import type { RaceScene } from './RaceScene.ts';

type PauseId = 'resume' | 'restart' | 'quit';

/** S8 Pause overlay: RESUME, RESTART, QUIT TO MAP. Esc resumes. */
export class PauseScene extends Phaser.Scene {
  private opponent: OpponentId = 'pip';

  constructor() {
    super(SceneKey.Pause);
  }

  create(data: { opponent: OpponentId }): void {
    this.opponent = data.opponent;
    applyCrt(this);
    // Content (cursor to the end of QUIT TO MAP) is 98 px wide, centred in the panel with 8 px of
    // padding above PAUSED and below the last item.
    addPanel(this, 88, 52, 144, 70);
    new Label(this, 160, 60, 'PAUSED', { align: 'center', color: PAL.gold, depth: 101 });
    const menu = new MenuList<PauseId>(
      this,
      [
        { id: 'resume', label: 'RESUME' },
        { id: 'restart', label: 'RESTART' },
        { id: 'quit', label: 'QUIT TO MAP' },
      ],
      { x: 111, y: 78, lineHeight: 14 },
    );
    onMenuKeys(this, (action) => {
      const race = this.scene.get(SceneKey.Race) as RaceScene;
      switch (action) {
        case 'up':
        case 'down':
          if (menu.move(action === 'up' ? -1 : 1)) playSfx('menu_move');
          return;
        case 'back':
          playSfx('menu_back');
          race.resumeRace();
          return;
        case 'confirm':
          playSfx('menu_select');
          if (menu.focusedId === 'resume') race.resumeRace();
          // Restarting creates a new Race, which resets the false start count (design 2.5.5).
          else if (menu.focusedId === 'restart') goTo(this, SceneKey.Race, { opponent: this.opponent });
          else goTo(this, SceneKey.Ladder);
          return;
        default:
          return;
      }
    });
  }
}
