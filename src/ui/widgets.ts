/**
 * Shared UI widgets: panel, vertical menu list and horizontal button row.
 * All geometry is whole pixels and every colour is a palette index.
 */
import type Phaser from 'phaser';
import { paletteColor } from '../art/index.ts';
import { PAL } from './hudMath.ts';
import { MenuModel, type MenuItem } from './menuModel.ts';
import { Label } from './text.ts';
import type { FontId } from './fonts.ts';
import { MENU_TAP_MIN, registerTapTarget, type TapRect } from './tapTargets.ts';

export const UI_DEPTH = 100;

/** Fills a whole-pixel rectangle with a palette colour. */
export function fillRect(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  index: number,
): void {
  g.fillStyle(paletteColor(index), 1);
  g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/**
 * Panel per design 6.6: fill index 2, 1 px index 8 border inside a 1 px index 1 outline.
 * (x, y, w, h) is the outer box including the outline.
 */
export function drawPanel(
  g: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  w: number,
  h: number,
  border: number = PAL.white,
  fill: number = PAL.panel,
): void {
  fillRect(g, x, y, w, h, PAL.ink);
  fillRect(g, x + 1, y + 1, w - 2, h - 2, border);
  fillRect(g, x + 2, y + 2, w - 4, h - 4, fill);
}

export function addPanel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  depth = UI_DEPTH,
): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics();
  g.setDepth(depth);
  drawPanel(g, x, y, w, h);
  return g;
}

export interface ListOptions {
  readonly x: number;
  readonly y: number;
  readonly lineHeight?: number;
  readonly font?: FontId;
  readonly depth?: number;
}

/**
 * Vertical menu with a '>' cursor. Focused item index 22, enabled items index 8, disabled index 5.
 * `valueText` (optional) renders a right-hand value column (Options screen).
 */
export class MenuList<Id extends string = string> {
  readonly model: MenuModel<Id>;
  readonly #labels: Label[] = [];
  readonly #values: Label[] = [];
  readonly #cursor: Label;
  readonly #x: number;
  readonly #y: number;
  readonly #lh: number;
  readonly #valueText: ((id: Id) => string | null) | null;
  readonly #valueX: number;

  constructor(
    scene: Phaser.Scene,
    items: readonly MenuItem<Id>[],
    opts: ListOptions & {
      readonly initial?: Id;
      readonly valueText?: (id: Id) => string | null;
      readonly valueX?: number;
    },
  ) {
    this.model = new MenuModel(items, opts.initial ?? null);
    this.#x = opts.x;
    this.#y = opts.y;
    this.#lh = opts.lineHeight ?? 12;
    this.#valueText = opts.valueText ?? null;
    this.#valueX = opts.valueX ?? opts.x + 120;
    const depth = opts.depth ?? UI_DEPTH + 1;
    const font = opts.font;
    items.forEach((item, i) => {
      const y = this.#y + i * this.#lh;
      this.#labels.push(new Label(scene, this.#x + 10, y, item.label, { depth, ...(font ? { font } : {}) }));
      this.#values.push(new Label(scene, this.#valueX, y, '', { depth, ...(font ? { font } : {}) }));
    });
    this.#cursor = new Label(scene, this.#x, this.#y, '>', { depth, color: PAL.gold });
    this.refresh();
  }

  get focusedId(): Id | null {
    return this.model.focused?.id ?? null;
  }

  move(delta: 1 | -1): boolean {
    const moved = this.model.move(delta);
    if (moved) this.refresh();
    return moved;
  }

  refresh(): void {
    const focus = this.model.index;
    this.model.items.forEach((item, i) => {
      const lab = this.#labels[i];
      const val = this.#values[i];
      const color = i === focus ? PAL.gold : item.enabled === false ? PAL.grey : PAL.white;
      lab?.setColor(color);
      if (val) {
        const v = this.#valueText ? this.#valueText(item.id) : null;
        val.setText(v ?? '').setColor(color);
      }
    });
    this.#cursor.setVisible(focus >= 0);
    if (focus >= 0) this.#cursor.setPosition(this.#x, this.#y + focus * this.#lh);
  }

  setVisible(v: boolean): void {
    for (const l of this.#labels) l.setVisible(v);
    for (const l of this.#values) l.setVisible(v);
    this.#cursor.setVisible(v && this.model.index >= 0);
  }

  /** Text baseline y of row `i`. */
  rowY(i: number): number {
    return this.#y + i * this.#lh;
  }

  /**
   * Tap targets (design 17.5): one rectangle per row, `width` px wide from the cursor column and one
   * line height tall (centred on the 8 px text), so rows never overlap. A tap focuses the row and
   * calls `onTap`. Rows listed in `skip` get no target (their scene registers its own).
   */
  enableTaps(scene: Phaser.Scene, width: number, onTap: (id: Id) => void, skip: readonly Id[] = []): void {
    this.model.items.forEach((item, i) => {
      if (skip.includes(item.id)) return;
      const rect = { x: this.#x - 4, y: this.rowY(i) + 4 - this.#lh / 2, w: width, h: this.#lh };
      registerTapTarget(scene, rect, () => {
        if (item.enabled === false) return;
        if (this.model.focus(item.id)) this.refresh();
        onTap(item.id);
      });
    });
  }
}

/**
 * Horizontal row of buttons. The focused button is drawn as `[LABEL]` in index 22 so focus is
 * carried by shape as well as colour (design 8.8).
 */
export class ButtonRow<Id extends string = string> {
  readonly model: MenuModel<Id>;
  readonly #labels: Label[] = [];
  readonly #dimmed = new Set<Id>();
  /** Bracket slot of each button: left and right edge and text y. */
  readonly #slots: { readonly x0: number; readonly x1: number; readonly y: number }[] = [];
  readonly #untaps: (() => void)[] = [];
  #active = true;

  /**
   * `centerX`: buttons are laid out centred on this x, `gap` px apart (between bracket edges).
   * A negative gap lets neighbours overlap their bracket slots (only one button is focused at a time).
   * `perLine` wraps the buttons into centred lines `lineStep` px apart (touch menus with a BACK item).
   */
  constructor(
    scene: Phaser.Scene,
    items: readonly MenuItem<Id>[],
    opts: {
      readonly centerX: number;
      readonly y: number;
      readonly gap?: number;
      readonly initial?: Id;
      readonly depth?: number;
      readonly perLine?: number;
      readonly lineStep?: number;
    },
  ) {
    this.model = new MenuModel(items, opts.initial ?? null);
    const gap = opts.gap ?? 8;
    const perLine = Math.max(1, opts.perLine ?? items.length);
    const lineStep = opts.lineStep ?? 20;
    for (let start = 0; start < items.length; start += perLine) {
      const line = items.slice(start, start + perLine);
      const y = opts.y + (start / perLine) * lineStep;
      const widths = line.map((it) => (it.label.length + 2) * 8);
      const total = widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, line.length - 1);
      let x = Math.round(opts.centerX - total / 2);
      line.forEach((item, i) => {
        const w = widths[i] ?? 0;
        this.#labels.push(new Label(scene, x, y, ` ${item.label} `, { depth: opts.depth ?? UI_DEPTH + 2 }));
        this.#slots.push({ x0: x, x1: x + w, y });
        x += w + gap;
      });
    }
    this.refresh();
  }

  get focusedId(): Id | null {
    return this.model.focused?.id ?? null;
  }

  move(delta: 1 | -1): boolean {
    const moved = this.model.move(delta);
    if (moved) this.refresh();
    return moved;
  }

  refresh(): void {
    this.model.items.forEach((item, i) => {
      const lab = this.#labels[i];
      if (!lab) return;
      const focused = this.#active && i === this.model.index;
      lab.setText(focused ? `[${item.label}]` : ` ${item.label} `);
      const unavailable = item.enabled === false || this.#dimmed.has(item.id);
      lab.setColor(unavailable ? PAL.grey : focused ? PAL.gold : PAL.white);
    });
  }

  setEnabled(id: Id, enabled: boolean): void {
    this.model.setEnabled(id, enabled);
    this.refresh();
  }

  /** Keeps the button focusable but drawn grey (an action that is unavailable right now). */
  setDimmed(id: Id, dimmed: boolean): void {
    if (dimmed) this.#dimmed.add(id);
    else this.#dimmed.delete(id);
    this.refresh();
  }

  /** Focus a button by id (no sound, no confirm). */
  focus(id: Id): void {
    if (this.model.focus(id)) this.refresh();
  }

  /**
   * An inactive row draws no focus bracket (the screen's cursor is on another row, for example the
   * event cards); it keeps its focused item for when the cursor comes back.
   */
  setActive(active: boolean): void {
    if (active === this.#active) return;
    this.#active = active;
    this.refresh();
  }

  labels(): readonly Label[] {
    return this.#labels;
  }

  /**
   * Tap rectangles in game px: each button's bracket slot, split at the midpoint where neighbours'
   * slots overlap or leave a gap, MENU_TAP_MIN px tall, centred on the 8 px text (design 17.5.2).
   * `dy` shifts them (the results card slides in, its targets sit at the final position).
   */
  tapRects(dy = 0): readonly TapRect[] {
    return this.#slots.map((s, i) => {
      const prev = this.#slots[i - 1];
      const next = this.#slots[i + 1];
      const left = prev && prev.y === s.y ? Math.round((prev.x1 + s.x0) / 2) : s.x0;
      const right = next && next.y === s.y ? Math.round((s.x1 + next.x0) / 2) : s.x1;
      return { x: left, y: s.y + 4 - MENU_TAP_MIN / 2 + dy, w: right - left, h: MENU_TAP_MIN };
    });
  }

  /** Buttons confirm on one tap (design 17.5.4): a tap focuses the button and calls `onConfirm`. */
  enableTaps(scene: Phaser.Scene, onConfirm: (id: Id) => void, dy = 0): void {
    const rects = this.tapRects(dy);
    this.model.items.forEach((item, i) => {
      const rect = rects[i];
      if (!rect) return;
      this.#untaps.push(
        registerTapTarget(scene, rect, () => {
          if (this.model.items[i]?.enabled === false) return;
          this.focus(item.id);
          onConfirm(item.id);
        }),
      );
    });
  }

  destroy(): void {
    for (const off of this.#untaps) off();
    this.#untaps.length = 0;
    for (const l of this.#labels) l.destroy();
  }
}
