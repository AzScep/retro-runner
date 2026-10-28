import Phaser from 'phaser';
import { paletteColor } from '../art/index.ts';
import { playMusic, playSfx } from '../audio/index.ts';
import { FONT_MINI } from '../ui/fonts.ts';
import { wrapMini } from '../ui/miniFont.ts';
import { pinFullscreenButton } from '../ui/fullscreen.ts';
import { PAL } from '../ui/hudMath.ts';
import type { MenuAction } from '../ui/keys.ts';
import type { MenuItem } from '../ui/menuModel.ts';
import { isToggle, optionValue, type OptId, type ToggleId } from '../ui/screenText.ts';
import { MENU_TAP_MIN, registerTapTarget } from '../ui/tapTargets.ts';
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
/** Touch copy where the keyboard help names keys. */
const TOUCH_HELP: Partial<Record<OptId, string>> = {
  volume: '- and +: master volume 0-10.',
  muted: 'Silence all sound. The title speaker also mutes.',
};
/** SCREEN SHAKE while reduced flashing is on: shown OFF and greyed (design 6.5). */
const SHAKE_LOCKED_HELP = 'Off while reduced flashing is on.';

/**
 * Layouts. Keyboard: 14 px rows with a help line. Touch (17.5): rows MENU_TAP_MIN (24) px apart so
 * every row is a 44 CSS px target on phones (21 px with Android's seventh row, HAPTICS, which only
 * fits that way; Android plays fullscreen after the first tap, where 21 px is 48 CSS px), volume
 * gets `-` and `+` buttons, and BACK is the first entry of a bottom row (17.5.6) whose right side
 * explains the focused row.
 */
const KEYBOARD = { listY: 30, lineHeight: 14, panelY: 20 } as const;
/** Touch rows fill y 12-159; BACK's tap row is 159-180. */
const TOUCH_ROWS = { top: 12, bottom: 159 } as const;
const TOUCH_BACK = { centerX: 32, y: 167, helpX: 64, helpW: 252 } as const;
const LIST_X = 36;
const VALUE_X = 216;
const ROW_TAP_W = 256;
/** Touch volume buttons beside the value (17.5.5), one row tall. */
const VOL = { minusX: 196, valueX: 236, plusX: 252, w: 24 } as const;

/** Touch row pitch for `rows` rows: MENU_TAP_MIN when they fit, else as many px as fit. */
function touchPitch(rows: number): number {
  return Math.min(MENU_TAP_MIN, Math.floor((TOUCH_ROWS.bottom - TOUCH_ROWS.top) / rows));
}

/** S7 Options: volume, mute, reduced flashing, screen shake, CRT, haptics (Android), reset records. */
export class OptionsScene extends Phaser.Scene {
  private list!: MenuList<OptId>;
  private help!: Label;
  /** Touch: the help wraps to a second mini line beside BACK. */
  private help2: Label | null = null;
  private touch = false;
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
    this.touch = touch;
    const items: MenuItem<OptId>[] = [
      { id: 'volume', label: 'VOLUME' },
      { id: 'muted', label: 'MUTE' },
      { id: 'reducedFlashing', label: 'REDUCED FLASHING' },
      { id: 'screenShake', label: 'SCREEN SHAKE' },
      { id: 'crt', label: 'CRT FILTER' },
      // Android only: listed only on a coarse-pointer device with navigator.vibrate (17.7).
      ...(hapticsSupported() ? [{ id: 'haptics' as const, label: 'HAPTICS' }] : []),
      { id: 'reset', label: 'RESET RECORDS' },
      ...(touch ? [] : [{ id: 'back' as const, label: 'BACK' }]),
    ];
    const bg = this.add.graphics().setDepth(UI_DEPTH);
    const pitch = touch ? touchPitch(items.length) : KEYBOARD.lineHeight;
    // Touch: the first row's tap rectangle starts at TOUCH_ROWS.top, centred on the 8 px text.
    const listY = touch ? TOUCH_ROWS.top + Math.floor(pitch / 2) - 4 : KEYBOARD.listY;
    if (touch) drawPanel(bg, 24, TOUCH_ROWS.top - 1, 272, items.length * pitch + 2);
    else drawPanel(bg, 24, KEYBOARD.panelY, 272, items.length * pitch + 8);
    new Label(this, 160, touch ? 2 : 6, 'OPTIONS', { align: 'center', color: PAL.gold });
    this.list = new MenuList<OptId>(this, items, {
      x: LIST_X,
      y: listY,
      lineHeight: pitch,
      valueX: VALUE_X,
      valueText: (id) => this.valueText(id),
    });
    this.help = touch
      ? new Label(this, TOUCH_BACK.helpX, TOUCH_BACK.y, '', { font: FONT_MINI, color: PAL.lightGrey })
      : new Label(this, 160, 146, '', { font: FONT_MINI, align: 'center', color: PAL.lightGrey });
    this.help2 = touch
      ? new Label(this, TOUCH_BACK.helpX, TOUCH_BACK.y + 8, '', { font: FONT_MINI, color: PAL.lightGrey })
      : null;

    if (touch) {
      this.list.enableTaps(this, ROW_TAP_W, (id) => this.tapRow(id), ['volume', 'screenShake']);
      const volRow = this.list.rowRect(0, ROW_TAP_W);
      const volY = this.list.rowY(0);
      // The VOLUME label itself only focuses the row; - and + change the value.
      registerTapTarget(this, { ...volRow, w: VOL.minusX - volRow.x }, () => {
        if (this.dialog) return;
        this.focusRow('volume');
      });
      new Label(this, VOL.minusX + VOL.w / 2, volY, '-', { align: 'center', depth: UI_DEPTH + 1 });
      this.volumeValue = new Label(this, VOL.valueX, volY, '', { align: 'center', depth: UI_DEPTH + 1 });
      new Label(this, VOL.plusX + VOL.w / 2, volY, '+', { align: 'center', depth: UI_DEPTH + 1 });
      registerTapTarget(this, { ...volRow, x: VOL.minusX, w: VOL.w }, () => this.tapVolume(-1));
      registerTapTarget(this, { ...volRow, x: VOL.plusX, w: VOL.w }, () => this.tapVolume(1));
      // SCREEN SHAKE stays tappable while it is locked off, to say why.
      const shakeRow = items.findIndex((it) => it.id === 'screenShake');
      registerTapTarget(this, this.list.rowRect(shakeRow, ROW_TAP_W), () => {
        if (this.dialog) return;
        if (settings().reducedFlashing) {
          playSfx('menu_back');
          this.refreshHelp(SHAKE_LOCKED_HELP);
          return;
        }
        this.focusRow('screenShake');
        this.tapRow('screenShake');
      });
      const back = new ButtonRow<'back'>(this, [{ id: 'back', label: 'BACK' }], {
        centerX: TOUCH_BACK.centerX,
        y: TOUCH_BACK.y,
      });
      // No bracket: the list's cursor is the focus on this screen, BACK is only a tap button.
      back.setActive(false);
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
    this.refreshShakeLock();
    this.refreshHelp();
    this.refreshVolume();

    const onSettings = (): void => {
      this.refreshShakeLock();
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

  private valueText(id: OptId): string | null {
    if (this.touch && id === 'volume') return null;
    // Reduced flashing also disables screen shake (design 6.5): the row says so.
    if (id === 'screenShake' && settings().reducedFlashing) return 'OFF';
    return optionValue(id, settings());
  }

  /** SCREEN SHAKE is greyed and skipped while reduced flashing is on. */
  private refreshShakeLock(): void {
    this.list.setEnabled('screenShake', !settings().reducedFlashing);
  }

  private focusRow(id: OptId): void {
    if (this.list.model.focus(id)) this.list.refresh();
    this.refreshHelp();
  }

  private refreshHelp(text?: string): void {
    const id = this.list.focusedId;
    const help = text ?? (id ? ((this.touch ? TOUCH_HELP[id] : undefined) ?? HELP[id]) : '');
    if (!this.help2) {
      this.help.setText(help);
      return;
    }
    // Touch: one line centred on BACK's text, or two lines around it.
    const lines = wrapMini(help, TOUCH_BACK.helpW);
    const two = lines.length > 1;
    this.help.setText(lines[0] ?? '').setPosition(TOUCH_BACK.helpX, TOUCH_BACK.y + (two ? -4 : 0));
    this.help2.setText(two ? lines.slice(1).join(' ') : '').setPosition(TOUCH_BACK.helpX, TOUCH_BACK.y + 4);
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
    this.focusRow('volume');
    this.setVolume(delta);
  }

  /** Option toggles confirm on one tap (17.5.4); RESET opens the confirmation. */
  private tapRow(id: OptId): void {
    if (this.dialog) return;
    this.refreshHelp();
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
