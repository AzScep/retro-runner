/**
 * Pure bake step (research 3): palette-indexed pixel maps -> RGBA bytes, with automatic 1 px
 * outlines (design 5.3). No Phaser, no DOM: used by registerArt, tests and tools/art.
 */
import { PALETTE, PALETTE_SIZE, RAMP_DARKEST } from '../palette.ts';

/** A rectangular grid of palette indices. 0 = transparent. Row-major. */
export interface IndexMap {
  readonly w: number;
  readonly h: number;
  readonly data: Uint8Array;
}

export type Legend = Readonly<Record<string, number>>;

export function createMap(w: number, h: number, fill = 0): IndexMap {
  if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0) {
    throw new RangeError(`bad map size ${w}x${h}`);
  }
  const data = new Uint8Array(w * h);
  if (fill) data.fill(fill);
  return { w, h, data };
}

export function cloneMap(m: IndexMap): IndexMap {
  return { w: m.w, h: m.h, data: m.data.slice() };
}

export function getPx(m: IndexMap, x: number, y: number): number {
  if (x < 0 || y < 0 || x >= m.w || y >= m.h) return 0;
  return m.data[y * m.w + x] as number;
}

export function setPx(m: IndexMap, x: number, y: number, v: number): void {
  if (x < 0 || y < 0 || x >= m.w || y >= m.h) return;
  m.data[y * m.w + x] = v;
}

/** Fill a rectangle (clipped). */
export function fillRect(m: IndexMap, x: number, y: number, w: number, h: number, v: number): void {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) setPx(m, xx, yy, v);
}

export function fromFn(w: number, h: number, fn: (x: number, y: number) => number): IndexMap {
  const m = createMap(w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m.data[y * w + x] = fn(x, y);
  return m;
}

/**
 * Parse rows of characters into an index map. '.' and ' ' are transparent; every other
 * character must be in the legend. Rows must all have the same length.
 */
export function parseRows(rows: readonly string[], legend: Legend): IndexMap {
  if (rows.length === 0) throw new Error('parseRows: no rows');
  const w = (rows[0] as string).length;
  const m = createMap(w, rows.length);
  rows.forEach((row, y) => {
    if (row.length !== w) throw new Error(`parseRows: row ${y} has length ${row.length}, expected ${w}`);
    for (let x = 0; x < w; x++) {
      const ch = row[x] as string;
      if (ch === '.' || ch === ' ') continue;
      const v = legend[ch];
      if (v === undefined) throw new Error(`parseRows: unknown char '${ch}' at ${x},${y}`);
      m.data[y * w + x] = v;
    }
  });
  return m;
}

export interface OutlineOptions {
  /** Outline index (default 1, design 5.3.2). */
  readonly color?: number;
  /**
   * Selective outline (design 5.3.3): outline pixels on the lit top/left edges take the darkest tone
   * of the adjacent material ramp. Bottom/right outlines always stay `color`.
   */
  readonly selout?: boolean;
}

/**
 * Add a 1 px outer outline: every transparent pixel 4-adjacent to an opaque pixel becomes outline.
 * The outline stays inside the map bounds, so art must leave a 1 px margin.
 */
export function outline(m: IndexMap, opts: OutlineOptions = {}): IndexMap {
  const color = opts.color ?? 1;
  const out = cloneMap(m);
  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      if (getPx(m, x, y) !== 0) continue;
      const up = getPx(m, x, y - 1);
      const down = getPx(m, x, y + 1);
      const left = getPx(m, x - 1, y);
      const right = getPx(m, x + 1, y);
      if (!up && !down && !left && !right) continue;
      let v = color;
      if (opts.selout && !up && !left) {
        // Lit side only: the shape is below and/or to the right of this pixel.
        const n = down || right;
        const dark = RAMP_DARKEST[n] ?? color;
        // Keep the silhouette readable: never use a tone equal to the neighbour itself.
        if (dark !== n && dark !== 0) v = dark;
      }
      out.data[y * m.w + x] = v;
    }
  }
  return out;
}

/** Replace indices via a lookup table (missing entries unchanged). Index 0 is never remapped. */
export function remap(m: IndexMap, table: Readonly<Record<number, number>>): IndexMap {
  const out = cloneMap(m);
  for (let i = 0; i < out.data.length; i++) {
    const v = out.data[i] as number;
    if (v === 0) continue;
    const r = table[v];
    if (r !== undefined) out.data[i] = r;
  }
  return out;
}

/** Every opaque pixel becomes `fill`; then an optional outline of `edge` around the shape. */
export function silhouette(m: IndexMap, fill: number, edge?: number): IndexMap {
  const out = cloneMap(m);
  for (let i = 0; i < out.data.length; i++) if (out.data[i]) out.data[i] = fill;
  if (edge === undefined) return out;
  // Recolour the outermost ring of the shape so it reads on dark panels.
  const ring = cloneMap(out);
  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      if (!getPx(out, x, y)) continue;
      if (!getPx(out, x - 1, y) || !getPx(out, x + 1, y) || !getPx(out, x, y - 1) || !getPx(out, x, y + 1)) {
        setPx(ring, x, y, edge);
      }
    }
  }
  return ring;
}

/** Copy opaque pixels of `src` onto `dst` at (dx, dy), clipped. */
export function blit(dst: IndexMap, src: IndexMap, dx: number, dy: number): void {
  for (let y = 0; y < src.h; y++) {
    for (let x = 0; x < src.w; x++) {
      const v = src.data[y * src.w + x] as number;
      if (v) setPx(dst, dx + x, dy + y, v);
    }
  }
}

export function flipH(m: IndexMap): IndexMap {
  return fromFn(m.w, m.h, (x, y) => getPx(m, m.w - 1 - x, y));
}

/** Copy a sub-rectangle. */
export function crop(m: IndexMap, x: number, y: number, w: number, h: number): IndexMap {
  return fromFn(w, h, (xx, yy) => getPx(m, x + xx, y + yy));
}

/** Palette indices -> RGBA8 bytes. Index 0 -> fully transparent. */
export function toRGBA(m: IndexMap, palette: readonly number[] = PALETTE): Uint8Array {
  const out = new Uint8Array(m.w * m.h * 4);
  for (let i = 0; i < m.data.length; i++) {
    const v = m.data[i] as number;
    if (v === 0) continue;
    const c = palette[v];
    if (c === undefined) throw new RangeError(`toRGBA: index ${v} not in palette`);
    out[i * 4] = (c >> 16) & 0xff;
    out[i * 4 + 1] = (c >> 8) & 0xff;
    out[i * 4 + 2] = c & 0xff;
    out[i * 4 + 3] = 0xff;
  }
  return out;
}

export function validIndices(m: IndexMap): boolean {
  for (const v of m.data) if (v >= PALETTE_SIZE) return false;
  return true;
}

export interface SheetRect {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** Pack same-size frames into a grid sheet. */
export function packSheet(
  frames: readonly { readonly name: string; readonly map: IndexMap }[],
  cols: number,
): { readonly map: IndexMap; readonly rects: readonly SheetRect[] } {
  const first = frames[0];
  if (!first) throw new Error('packSheet: no frames');
  const fw = first.map.w;
  const fh = first.map.h;
  const c = Math.max(1, Math.min(cols, frames.length));
  const rows = Math.ceil(frames.length / c);
  const sheet = createMap(fw * c, fh * rows);
  const rects: SheetRect[] = [];
  frames.forEach((f, i) => {
    if (f.map.w !== fw || f.map.h !== fh) throw new Error(`packSheet: frame ${f.name} size mismatch`);
    const x = (i % c) * fw;
    const y = Math.floor(i / c) * fh;
    blit(sheet, f.map, x, y);
    rects.push({ name: f.name, x, y, w: fw, h: fh });
  });
  return { map: sheet, rects };
}

/** Pack frames of differing sizes on one row (left to right), for small mixed atlases. */
export function packRow(frames: readonly { readonly name: string; readonly map: IndexMap }[]): {
  readonly map: IndexMap;
  readonly rects: readonly SheetRect[];
} {
  const w = frames.reduce((s, f) => s + f.map.w, 0);
  const h = frames.reduce((s, f) => Math.max(s, f.map.h), 0);
  const sheet = createMap(Math.max(1, w), Math.max(1, h));
  const rects: SheetRect[] = [];
  let x = 0;
  for (const f of frames) {
    blit(sheet, f.map, x, 0);
    rects.push({ name: f.name, x, y: 0, w: f.map.w, h: f.map.h });
    x += f.map.w;
  }
  return { map: sheet, rects };
}
