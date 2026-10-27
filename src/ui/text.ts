/**
 * Bitmap text helper (design 6.1): integer scale, integer position, palette colour via tint,
 * 1 px drop shadow in index 1 by default, optional 1 px index 1 outline (countdown, 6.3).
 */
import type Phaser from 'phaser';
import { paletteColor } from '../art/index.ts';
import { FONT_MINI, FONT_PS, FONT_SIZE, type FontId } from './fonts.ts';
import { PAL } from './hudMath.ts';
import { normaliseMini } from './miniFont.ts';

export type Align = 'left' | 'center' | 'right';

export interface LabelOptions {
  readonly font?: FontId;
  /** Integer glyph scale. 1, 2 and 4 per design; 5 only for the one-frame countdown pop. */
  readonly scale?: 1 | 2 | 4 | 5;
  /** Palette index of the glyph colour (default 8, white). */
  readonly color?: number;
  /** 1 px drop shadow in index 1 (default true). */
  readonly shadow?: boolean;
  /** 1 px outline in index 1 on all four sides (countdown digits). */
  readonly outline?: boolean;
  /** Horizontal anchor: x is the left edge, centre or right edge of the text. */
  readonly align?: Align;
  readonly depth?: number;
}

/** Name given to the outline copies so tools (the test hook) can skip them. */
export const OUTLINE_NAME = 'rr-outline';

const OUTLINE_OFFSETS: readonly (readonly [number, number])[] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

export class Label {
  readonly scene: Phaser.Scene;
  readonly font: FontId;
  readonly main: Phaser.GameObjects.BitmapText;
  readonly #outline: Phaser.GameObjects.BitmapText[] = [];
  #x: number;
  #y: number;
  #align: Align;
  #scale: number;
  #color: number;

  constructor(scene: Phaser.Scene, x: number, y: number, text: string, opts: LabelOptions = {}) {
    this.scene = scene;
    this.font = opts.font ?? FONT_PS;
    this.#x = x;
    this.#y = y;
    this.#align = opts.align ?? 'left';
    this.#scale = opts.scale ?? 1;
    this.#color = opts.color ?? PAL.white;
    const size = FONT_SIZE[this.font] * this.#scale;
    const content = this.#normalise(text);
    if (opts.outline === true) {
      for (let i = 0; i < OUTLINE_OFFSETS.length; i++) {
        const o = scene.add.bitmapText(0, 0, this.font, content, size);
        o.setTint(paletteColor(PAL.ink));
        o.setName(OUTLINE_NAME);
        this.#outline.push(o);
      }
    }
    this.main = scene.add.bitmapText(0, 0, this.font, content, size);
    this.main.setTint(paletteColor(this.#color));
    if (opts.shadow !== false) this.main.setDropShadow(1, 1, paletteColor(PAL.ink), 1);
    this.setDepth(opts.depth ?? 100);
    this.#layout();
  }

  #normalise(text: string): string {
    return this.font === FONT_MINI ? normaliseMini(text) : text;
  }

  #layout(): void {
    const w = this.width;
    const left =
      this.#align === 'left' ? this.#x : this.#align === 'center' ? this.#x - Math.floor(w / 2) : this.#x - w;
    const x = Math.round(left);
    const y = Math.round(this.#y);
    this.main.setPosition(x, y);
    this.#outline.forEach((o, i) => {
      const off = OUTLINE_OFFSETS[i] ?? [0, 0];
      o.setPosition(x + off[0], y + off[1]);
    });
  }

  get text(): string {
    return this.main.text;
  }

  /** Width in px of the rendered text (without shadow). */
  get width(): number {
    return Math.round(this.main.width);
  }

  get height(): number {
    return Math.round(this.main.height);
  }

  get visible(): boolean {
    return this.main.visible;
  }

  setText(text: string): this {
    const content = this.#normalise(text);
    if (content === this.main.text) return this;
    this.main.setText(content);
    for (const o of this.#outline) o.setText(content);
    this.#layout();
    return this;
  }

  setColor(index: number): this {
    if (index === this.#color) return this;
    this.#color = index;
    this.main.setTint(paletteColor(index));
    return this;
  }

  setScale(scale: 1 | 2 | 4 | 5): this {
    if (scale === this.#scale) return this;
    this.#scale = scale;
    const size = FONT_SIZE[this.font] * scale;
    this.main.setFontSize(size);
    for (const o of this.#outline) o.setFontSize(size);
    this.#layout();
    return this;
  }

  setPosition(x: number, y: number): this {
    this.#x = x;
    this.#y = y;
    this.#layout();
    return this;
  }

  setVisible(visible: boolean): this {
    this.main.setVisible(visible);
    for (const o of this.#outline) o.setVisible(visible);
    return this;
  }

  setDepth(depth: number): this {
    for (const o of this.#outline) o.setDepth(depth);
    this.main.setDepth(depth);
    return this;
  }

  /** Assign all objects to a camera-ignore list or container. */
  objects(): Phaser.GameObjects.BitmapText[] {
    return [...this.#outline, this.main];
  }

  destroy(): void {
    for (const o of this.#outline) o.destroy();
    this.main.destroy();
  }
}

/** Shorthand factory. */
export function label(scene: Phaser.Scene, x: number, y: number, text: string, opts?: LabelOptions): Label {
  return new Label(scene, x, y, text, opts);
}

export { FONT_MINI, FONT_PS };
