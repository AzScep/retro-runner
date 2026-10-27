/**
 * Pure atlas packing: every baked map goes into one RGBA page so the renderer binds a single
 * texture for all art. Phaser 4 compiles one shader variant per distinct texture count in a batch,
 * so ~120 separate textures meant new variants (50-450 ms stalls) appearing mid-race.
 */
import { PALETTE } from '../palette.ts';
import type { IndexMap } from './index.ts';

export interface AtlasSlot {
  readonly x: number;
  readonly y: number;
}

export interface AtlasLayout {
  readonly w: number;
  readonly h: number;
  /** Position of each input, in input order. */
  readonly slots: readonly AtlasSlot[];
}

/**
 * Shelf packing: tallest first, left to right, a new shelf when a row is full. `pad` transparent
 * pixels separate neighbours. The page is `maxW` wide (fits every WebGL implementation at 2048)
 * and only as tall as needed.
 */
export function packAtlas(
  sizes: readonly { readonly w: number; readonly h: number }[],
  maxW = 2048,
  pad = 1,
): AtlasLayout {
  const order = sizes.map((_, i) => i).sort((a, b) => sizes[b]!.h - sizes[a]!.h || a - b);
  const slots: AtlasSlot[] = new Array<AtlasSlot>(sizes.length);
  let x = 0;
  let y = 0;
  let shelfH = 0;
  let usedW = 0;
  for (const i of order) {
    const { w, h } = sizes[i]!;
    if (w > maxW) throw new RangeError(`packAtlas: ${w} px wide does not fit a ${maxW} px page`);
    if (x > 0 && x + w > maxW) {
      y += shelfH + pad;
      x = 0;
      shelfH = 0;
    }
    slots[i] = { x, y };
    x += w + pad;
    shelfH = Math.max(shelfH, h);
    usedW = Math.max(usedW, x - pad);
  }
  return { w: Math.max(1, usedW), h: Math.max(1, y + shelfH), slots };
}

/** PALETTE as RGBA8 bytes per index (index 0 stays transparent black). */
const PALETTE_RGBA = (() => {
  const out = new Uint8Array(PALETTE.length * 4);
  PALETTE.forEach((c, i) => {
    if (i === 0) return;
    out.set([(c >> 16) & 0xff, (c >> 8) & 0xff, c & 0xff, 0xff], i * 4);
  });
  return out;
})();

/** Writes `map` as RGBA8 into an atlas page of width `pageW` at (dx, dy). Same colours as toRGBA. */
export function writeRGBA(page: Uint8Array, pageW: number, map: IndexMap, dx: number, dy: number): void {
  const { w, h, data } = map;
  for (let y = 0; y < h; y++) {
    let src = y * w;
    let dst = ((dy + y) * pageW + dx) * 4;
    for (let x = 0; x < w; x++, src++, dst += 4) {
      const v = data[src]!;
      if (v === 0) continue;
      if (v * 4 >= PALETTE_RGBA.length) throw new RangeError(`writeRGBA: index ${v} not in palette`);
      page[dst] = PALETTE_RGBA[v * 4]!;
      page[dst + 1] = PALETTE_RGBA[v * 4 + 1]!;
      page[dst + 2] = PALETTE_RGBA[v * 4 + 2]!;
      page[dst + 3] = 0xff;
    }
  }
}
