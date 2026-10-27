import Phaser from 'phaser';
import { paletteColor } from '../art/index.ts';
import { playMusic, playSfx } from '../audio/index.ts';
import { FONT_MINI } from '../ui/fonts.ts';
import { PAL } from '../ui/hudMath.ts';
import type { MenuAction } from '../ui/keys.ts';
import { isToggle, optionValue, type OptId, type ToggleId } from '../ui/screenText.ts';
import { Label } from '../ui/text.ts';
import { addPanel, ButtonRow, drawPanel, MenuList, UI_DEPTH } from '../ui/widgets.ts';
import {
  applyAudioSettings,
  applyCrt,
  getApp,
  goTo,
  onMenuKeys,
  SceneKey,
  settings,
  SETTINGS_CHANGED,
  updateSettings,
} from './app.ts';

const HELP: Readonly<Record<OptId, string>> = {
  volume: 'Left/Right: master volume 0-10.',
  muted: 'Silence all sound. M toggles mute on any screen.',
  reducedFlashing: 'Max 1 flash per second. No flashbulbs, no screen shake.',
  screenShake: 'Camera shake on impacts during races.',
  crt: 'Optional CRT curvature and scanlines.',
  reset: 'Delete all times, unlocks and settings.',
  back: 'Return to the ladder map.',
};

/** S7 Options: volume, mute, reduced flashing, screen shake, CRT, reset records (double confirm). */
export class OptionsScene extends Phaser.Scene {
  private list!: MenuList<OptId>;
  private help!: Label;
  private dialog: {
    readonly objs: Phaser.GameObjects.GameObject[];
    readonly row: ButtonRow<'yes' | 'no'>;
  } | null = null;

  constructor() {
    super(SceneKey.Options);
  }

  create(): void {
    this.dialog = null;
    this.cameras.main.setBackgroundColor(paletteColor(PAL.ink));
    applyCrt(this);
    const bg = this.add.graphics().setDepth(UI_DEPTH);
    drawPanel(bg, 24, 20, 272, 112);
    new Label(this, 160, 6, 'OPTIONS', { align: 'center', color: PAL.gold });
    this.list = new MenuList<OptId>(
      this,
      [
        { id: 'volume', label: 'VOLUME' },
        { id: 'muted', label: 'MUTE' },
        { id: 'reducedFlashing', label: 'REDUCED FLASHING' },
        { id: 'screenShake', label: 'SCREEN SHAKE' },
        { id: 'crt', label: 'CRT FILTER' },
        { id: 'reset', label: 'RESET RECORDS' },
        { id: 'back', label: 'BACK' },
      ],
      { x: 36, y: 30, lineHeight: 14, valueX: 216, valueText: (id) => optionValue(id, settings()) },
    );
    this.help = new Label(this, 160, 146, '', { font: FONT_MINI, align: 'center', color: PAL.lightGrey });
    new Label(this, 160, 166, 'ENTER: CHANGE    ESC: BACK', {
      font: FONT_MINI,
      align: 'center',
      color: PAL.grey,
    });
    this.refreshHelp();

    const onSettings = (): void => this.list.refresh();
    this.game.events.on(SETTINGS_CHANGED, onSettings);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.game.events.off(SETTINGS_CHANGED, onSettings));

    playMusic('ladder');
    onMenuKeys(this, (action) => (this.dialog ? this.onDialog(action) : this.onList(action)));
  }

  private refreshHelp(text?: string): void {
    const id = this.list.focusedId;
    this.help.setText(text ?? (id ? HELP[id] : ''));
  }

  private onList(action: MenuAction): void {
    const id = this.list.focusedId;
    switch (action) {
      case 'up':
      case 'down':
        if (this.list.move(action === 'up' ? -1 : 1)) {
          playSfx('menu_move');
          this.refreshHelp();
        }
        return;
      case 'left':
      case 'right':
        if (id === 'volume') {
          const v = Math.min(10, Math.max(0, settings().volume + (action === 'left' ? -1 : 1)));
          if (v !== settings().volume) {
            updateSettings(this.game, { volume: v });
            playSfx('menu_move');
          }
        } else if (id && isToggle(id)) {
          this.toggle(id);
        }
        return;
      case 'confirm':
        if (id && isToggle(id)) this.toggle(id);
        else if (id === 'reset') this.openDialog();
        else if (id === 'back') {
          playSfx('menu_back');
          goTo(this, SceneKey.Ladder);
        }
        return;
      case 'back':
        playSfx('menu_back');
        goTo(this, SceneKey.Ladder);
        return;
      default:
        return;
    }
  }

  private toggle(id: ToggleId): void {
    updateSettings(this.game, { [id]: !settings()[id] });
    if (id === 'crt') applyCrt(this);
    playSfx('menu_select');
  }

  /** Second confirmation for reset (design 4.3.4): "ARE YOU SURE? YES / NO", default NO. */
  private openDialog(): void {
    playSfx('menu_select');
    // Spans the list panel's full width and exactly covers rows 3-5 (y 58-94), so no option label
    // is cut in half; RESET RECORDS stays visible right below it.
    const objs: Phaser.GameObjects.GameObject[] = [addPanel(this, 28, 54, 264, 44, UI_DEPTH + 10)];
    const q = new Label(this, 160, 64, 'ARE YOU SURE?', {
      align: 'center',
      color: PAL.redLight,
      depth: UI_DEPTH + 11,
    });
    objs.push(...q.objects());
    const row = new ButtonRow<'yes' | 'no'>(
      this,
      [
        { id: 'yes', label: 'YES' },
        { id: 'no', label: 'NO' },
      ],
      { centerX: 160, y: 80, gap: 8, initial: 'no', depth: UI_DEPTH + 11 },
    );
    for (const l of row.labels()) objs.push(...l.objects());
    this.dialog = { objs, row };
  }

  private closeDialog(): void {
    for (const o of this.dialog?.objs ?? []) o.destroy();
    this.dialog = null;
  }

  private onDialog(action: MenuAction): void {
    const d = this.dialog;
    if (!d) return;
    if (action === 'left' || action === 'right') {
      if (d.row.move(action === 'left' ? -1 : 1)) playSfx('menu_move');
    } else if (action === 'back') {
      playSfx('menu_back');
      this.closeDialog();
    } else if (action === 'confirm') {
      const yes = d.row.focusedId === 'yes';
      this.closeDialog();
      if (yes) {
        const app = getApp();
        app.records.reset();
        app.ladderCursor = 'pip';
        app.championPending = false;
        applyAudioSettings();
        applyCrt(this);
        this.game.events.emit(SETTINGS_CHANGED);
        playSfx('menu_select');
        this.refreshHelp('Records reset.');
      } else {
        playSfx('menu_back');
      }
    }
  }
}
