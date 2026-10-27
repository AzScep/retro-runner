/**
 * Speech bubble (design 31.2, 30.2 step 8): ART's 9-slice panel (index 8 fill, index 1 outline) and
 * 3x3 tail, with mini-font text in index 1 drawn here. The game's Phaser build has no NineSlice, so
 * the 9 slices are images: corners at their size, edges and centre stretched along one axis only
 * (each slice is uniform along it, so nearest-neighbour stretching stays palette-exact). Placed above an anchor point (a head), clamped
 * inside the screen, the tail under the bubble pointing at the anchor.
 */
import type Phaser from 'phaser';
import { SPEECH_BUBBLE } from '../art/index.ts';
import { FONT_MINI } from './fonts.ts';
import { BUBBLE_PAD, bubbleBox, PAL, type AvoidRect, type BubbleBox } from './hudMath.ts';
import { Label } from './text.ts';

const PAD = BUBBLE_PAD;
/** ART's named 4x4 slice frames of the bubble texture, in reading order. */
const SLICES = ['tl', 't', 'tr', 'l', 'c', 'r', 'bl', 'b', 'br'] as const;

export class SpeechBubble {
  readonly #slices: Phaser.GameObjects.Image[];
  readonly #tail: Phaser.GameObjects.Image;
  readonly #label: Label;
  #text = '';
  #box: BubbleBox | null = null;

  constructor(scene: Phaser.Scene, depth: number) {
    this.#slices = SLICES.map((f) =>
      scene.add.image(0, 0, SPEECH_BUBBLE.key, f).setOrigin(0, 0).setDepth(depth).setVisible(false),
    );
    this.#tail = scene.add
      .image(0, 0, SPEECH_BUBBLE.tailKey)
      .setOrigin(0, 0)
      .setDepth(depth + 1)
      .setVisible(false);
    this.#label = new Label(scene, 0, 0, '', {
      font: FONT_MINI,
      color: PAL.ink,
      shadow: false,
      depth: depth + 1,
    });
    this.#label.setVisible(false);
  }

  get text(): string | null {
    return this.#box ? this.#text : null;
  }

  show(text: string, ax: number, ay: number, avoid: AvoidRect | null = null): void {
    const box = bubbleBox(text, ax, ay, 320, avoid);
    const same =
      this.#box !== null &&
      text === this.#text &&
      box.x === this.#box.x &&
      box.y === this.#box.y &&
      box.tailX === this.#box.tailX;
    if (same) return;
    this.#text = text;
    this.#box = box;
    this.#layoutSlices(box);
    this.#tail.setPosition(box.tailX, box.tailY).setVisible(true);
    this.#label
      .setText(text)
      .setPosition(box.x + PAD, box.y + PAD)
      .setVisible(true);
  }

  #layoutSlices(box: BubbleBox): void {
    const c = SPEECH_BUBBLE.corner;
    const xs = [box.x, box.x + c, box.x + box.w - c];
    const ys = [box.y, box.y + c, box.y + box.h - c];
    const ws = [c, box.w - 2 * c, c];
    const hs = [c, box.h - 2 * c, c];
    this.#slices.forEach((img, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      img
        .setPosition(xs[col] ?? 0, ys[row] ?? 0)
        .setDisplaySize(ws[col] ?? c, hs[row] ?? c)
        .setVisible(true);
    });
  }

  hide(): void {
    if (this.#box === null) return;
    this.#box = null;
    for (const img of this.#slices) img.setVisible(false);
    this.#tail.setVisible(false);
    this.#label.setVisible(false);
  }

  destroy(): void {
    for (const img of this.#slices) img.destroy();
    this.#tail.destroy();
    this.#label.destroy();
  }
}
