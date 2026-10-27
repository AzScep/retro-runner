import Phaser from 'phaser';
import { paletteColor } from '../art/index.ts';
import { playMusic, playSfx } from '../audio/index.ts';
import { FONT_MINI } from '../ui/fonts.ts';
import { pinFullscreenButton } from '../ui/fullscreen.ts';
import { PAL } from '../ui/hudMath.ts';
import type { MenuAction } from '../ui/keys.ts';
import type { MenuItem } from '../ui/menuModel.ts';
import { isToggle, optionValue, type OptId, type ToggleId } from '../ui/screenText.ts';
import { registerTapTarget } from '../ui/tapTargets.ts';
import { Label } from '../ui/text.ts';
import { addPanel, ButtonRow, drawPanel, MenuList, UI_DEPTH } from '../ui/widgets.ts';
import {
  applyCrt,
  goTo,
  hapticsSupported,
  isTouch,
  onMenuKeys,
  resetRecords,
  restartOnModalityChange,
  SceneKey,
  settings,
  SETTINGS_CHANGED,
  updateSettings,
} from './app.ts';

export interface OptionsData {
  /** Where Esc / BACK returns to (S2 or S10). */
  readonly from?: typeof SceneKey.Ladder | typeof SceneKey.Events;
}

const HELP: Readonly<Record<OptId, string>> = {
  volume: 'Left/Right: master volume 0-10.',
  muted: 'Silence all sound. M toggles mute on any screen.',
  reducedFlashing: 'Max 1 flash per second. No flashbulbs, no screen shake.',
  screenShake: 'Camera shake on impacts during races.',
  crt: 'Optional CRT curvature and scanlines.',
  haptics: 'Short vibrations on fumbles, false starts and hurdle hits.',
  reset: 'Delete all times and unlocks. Settings stay.',
  back: 'Return to the previous screen.',
};

/**
 * Layouts. Keyboard: 14 px rows with a help line. Touch (17.5): 20 px rows so every row is a 20 px tap
 * target, volume gets `-` and `+` buttons, and BACK moves to a button row at the bottom (17.5.6).
 */
const KEYBOARD = { listY: 30, lineHeight: 14, panelY: 20 } as const;
const TOUCH = { listY: 26, lineHeight: 20, panelY: 18 } as const;
const LIST_X = 36;
const VALUE_X = 216;
const ROW_TAP_W = 256;
/** Touch volume buttons, 20 x 20 each beside the value (17.5.5). */
const VOL = { minusX: 204, valueX: 238, plusX: 252 } as const;

/** S7 Options: volume, mute, reduced flashing, screen shake, CRT, haptics (Android), reset records. */
export class OptionsScene extends Phaser.Scene {
  private list!: MenuList<OptId>;
  private help!: Label;
  private volumeValue: Label | null = null;
  private from: NonNullable<OptionsData['from']> = SceneKey.Ladder;
  private dialog: {
    readonly objs: Phaser.GameObjects.GameObject[];
    readonly row: ButtonRow<'yes' | 'no'>;
  } | null = null;

  constructor() {
    super(SceneKey.Options);
  }

  create(data: OptionsData = {}): void {
    this.dialog = null;
    this.volumeValue = null;
    this.from = data.from ?? SceneKey.Ladder;
    this.cameras.main.setBackgroundColor(paletteColor(PAL.ink));
    applyCrt(this);
    const touch = isTouch();
    const layout = touch ? TOUCH : KEYBOARD;
    const items: MenuItem<OptId>[] = [
      { id: 'volume', label: 'VOLUME' },
      { id: 'muted', label: 'MUTE' },
      { id: 'reducedFlashing', label: 'REDUCED FLASHING' },
      { id: 'screenShake', label: 'SCREEN SHAKE' },
      { id: 'crt', label: 'CRT FILTER' },
      // Android only: listed only where navigator.vibrate exists (17.7).
      ...(hapticsSupported() ? [{ id: 'haptics' as const, label: 'HAPTICS' }] : []),
      { id: 'reset', label: 'RESET RECORDS' },
      ...(touch ? [] : [{ id: 'back' as const, label: 'BACK' }]),
    ];
    const bg = this.add.graphics().setDepth(UI_DEPTH);
    drawPanel(bg, 24, layout.panelY, 272, items.length * layout.lineHeight + 8);
    new Label(this, 160, touch ? 5 : 6, 'OPTIONS', { align: 'center', color: PAL.gold });
    this.list = new MenuList<OptId>(this, items, {
      x: LIST_X,
      y: layout.listY,
      lineHeight: layout.lineHeight,
      valueX: VALUE_X,
      valueText: (id) => (touch && id === 'volume' ? null : optionValue(id, settings())),
    });
    this.help = new Label(this, 160, 146, '', { font: FONT_MINI, align: 'center', color: PAL.lightGrey });

    if (touch) {
      this.help.setVisible(false);
      this.list.enableTaps(this, ROW_TAP_W, (id) => this.tapRow(id), ['volume']);
      const volY = this.list.rowY(0);
      // The VOLUME label itself only focuses the row; - and + change the value.
      registerTapTarget(this, { x: LIST_X - 4, y: volY - 6, w: VOL.minusX - (LIST_X - 4), h: 20 }, () => {
        if (this.dialog) return;
        if (this.list.model.focus('volume')) this.list.refresh();
      });
      new Label(this, VOL.minusX + 10, volY, '-', { align: 'center', depth: UI_DEPTH + 1 });
      this.volumeValue = new Label(this, VOL.valueX, volY, '', { align: 'center', depth: UI_DEPTH + 1 });
      new Label(this, VOL.plusX + 10, volY, '+', { align: 'center', depth: UI_DEPTH + 1 });
      registerTapTarget(this, { x: VOL.minusX, y: volY - 6, w: 20, h: 20 }, () => this.tapVolume(-1));
      registerTapTarget(this, { x: VOL.plusX, y: volY - 6, w: 20, h: 20 }, () => this.tapVolume(1));
      const back = new ButtonRow<'back'>(this, [{ id: 'back', label: 'BACK' }], { centerX: 160, y: 168 });
      back.enableTaps(this, () => {
        if (!this.dialog) this.back();
      });
    } else {
      new Label(this, 160, 166, 'ENTER: CHANGE    ESC: BACK', {
        font: FONT_MINI,
        align: 'center',
        color: PAL.grey,
      });
    }
    this.refreshHelp();
    this.refreshVolume();

    const onSettings = (): void => {
      this.list.refresh();
      this.refreshVolume();
    };
    this.game.events.on(SETTINGS_CHANGED, onSettings);
    // iPad shows the fullscreen button on Title and Options (design 17.6).
    pinFullscreenButton(true);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => pinFullscreenButton(false));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.game.events.off(SETTINGS_CHANGED, onSettings));

    playMusic('ladder');
    restartOnModalityChange(this, { from: this.from } satisfies OptionsData);
    onMenuKeys(this, (action) => (this.dialog ? this.onDialog(action) : this.onList(action)));
  }

  private refreshHelp(text?: string): void {
    const id = this.list.focusedId;
    this.help.setText(text ?? (id ? HELP[id] : ''));
  }

  private refreshVolume(): void {
    this.volumeValue?.setText(String(settings().volume));
  }

  private back(): void {
    playSfx('menu_back');
    goTo(this, this.from);
  }

  private setVolume(delta: -1 | 1): void {
    const v = Math.min(10, Math.max(0, settings().volume + delta));
    if (v !== settings().volume) {
      updateSettings(this.game, { volume: v });
      playSfx('menu_move');
    }
  }

  private tapVolume(delta: -1 | 1): void {
    if (this.dialog) return;
    if (this.list.model.focus('volume')) this.list.refresh();
    this.setVolume(delta);
  }

  /** Option toggles confirm on one tap (17.5.4); RESET opens the confirmation. */
  private tapRow(id: OptId): void {
    if (this.dialog) return;
    if (isToggle(id)) this.toggle(id);
    else if (id === 'reset') this.openDialog();
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
        if (id === 'volume') this.setVolume(action === 'left' ? -1 : 1);
        else if (id && isToggle(id)) this.toggle(id);
        return;
      case 'confirm':
        if (id && isToggle(id)) this.toggle(id);
        else if (id === 'reset') this.openDialog();
        else if (id === 'back') this.back();
        return;
      case 'back':
        this.back();
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
    // Spans the list panel's full width and covers three rows around the middle of the list, so the
    // RESET RECORDS row stays visible below it.
    const touch = isTouch();
    const y = touch ? 58 : 54;
    const h = touch ? 60 : 44;
    const objs: Phaser.GameObjects.GameObject[] = [addPanel(this, 28, y, 264, h, UI_DEPTH + 10)];
    const q = new Label(this, 160, y + 10, 'ARE YOU SURE?', {
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
      { centerX: 160, y: y + (touch ? 36 : 26), gap: 8, initial: 'no', depth: UI_DEPTH + 11 },
    );
    for (const l of row.labels()) objs.push(...l.objects());
    row.enableTaps(this, (id) => this.answer(id === 'yes'));
    this.dialog = { objs, row };
  }

  private closeDialog(): void {
    for (const o of this.dialog?.objs ?? []) o.destroy();
    this.dialog?.row.destroy();
    this.dialog = null;
  }

  private answer(yes: boolean): void {
    this.closeDialog();
    if (yes) {
      resetRecords(this.game);
      applyCrt(this);
      playSfx('menu_select');
      this.refreshHelp('Records reset.');
    } else {
      playSfx('menu_back');
    }
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
      this.answer(d.row.focusedId === 'yes');
    }
  }
}
