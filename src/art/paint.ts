/**
 * Small pure raster helpers for procedural art (effects, portraits, stadium). All output is
 * palette indices, hard edges, no anti-aliasing.
 */
import { setPx, getPx, type IndexMap } from './bake/index.ts';

/** [line, shadow, base, highlight] */
export type Ramp4 = readonly [number, number, number, number];

/** Light from the top-left: pick a tone from a surface normal-ish offset. */
export function shade(ramp: Ramp4, nx: number, ny: number, hi = 0.45, sh = -0.25): number {
  const lit = (-nx - ny) * Math.SQRT1_2;
  return (lit > hi ? ramp[3] : lit < sh ? ramp[1] : ramp[2]) as number;
}

/** Spherical shading: normal (nx, ny, nz) on a dome, light from the top-left-front. */
export function shadeSphere(ramp: Ramp4, nx: number, ny: number, hi = 0.75, sh = -0.05): number {
  const r2 = nx * nx + ny * ny;
  const nz = Math.sqrt(Math.max(0, 1 - Math.min(1, r2)));
  const lit = (-nx - ny + nz) / Math.sqrt(3);
  return (lit > hi ? ramp[3] : lit < sh ? ramp[1] : ramp[2]) as number;
}

/** Filled, shaded ellipse (pixel centres). */
export function ellipse(
  m: IndexMap,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  ramp: Ramp4 | number,
  hi?: number,
  sh?: number,
): void {
  for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
    for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
      const dx = (x + 0.5 - cx) / rx;
      const dy = (y + 0.5 - cy) / ry;
      if (dx * dx + dy * dy > 1) continue;
      setPx(m, x, y, typeof ramp === 'number' ? ramp : shade(ramp, dx, dy, hi, sh));
    }
  }
}

export function rect(m: IndexMap, x: number, y: number, w: number, h: number, v: number): void {
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) setPx(m, xx, yy, v);
}

/** Bresenham line, 1 px. */
export function line(m: IndexMap, x0: number, y0: number, x1: number, y1: number, v: number): void {
  let x = Math.round(x0);
  let y = Math.round(y0);
  const X = Math.round(x1);
  const Y = Math.round(y1);
  const dx = Math.abs(X - x);
  const dy = -Math.abs(Y - y);
  const sx = x < X ? 1 : -1;
  const sy = y < Y ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    setPx(m, x, y, v);
    if (x === X && y === Y) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/** Filled polygon (even-odd, pixel centres). */
export function poly(m: IndexMap, pts: readonly (readonly [number, number])[], v: number): void {
  const ys = pts.map((p) => p[1]);
  for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++) {
    const py = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i] as readonly [number, number];
      const b = pts[(i + 1) % pts.length] as readonly [number, number];
      if (a[1] <= py !== b[1] <= py) xs.push(a[0] + ((py - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      for (let x = Math.ceil((xs[k] as number) - 0.5); x <= Math.floor((xs[k + 1] as number) - 0.5); x++) {
        setPx(m, x, y, v);
      }
    }
  }
}

/** Recolour opaque pixels satisfying a predicate. */
export function recolor(m: IndexMap, fn: (x: number, y: number, v: number) => number): void {
  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      const v = getPx(m, x, y);
      if (v) setPx(m, x, y, fn(x, y, v));
    }
  }
}

/** 2x2 checker dither test (design 5.4.4, backgrounds only). */
export function checker(x: number, y: number): boolean {
  return ((x >> 0) + (y >> 0)) % 2 === 0;
}

/** Deterministic hash noise in [0, 1). */
export function hash(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** 3x5 pixel font for signage (digits, a few letters). */
const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['###', '..#', '###', '#..', '###'],
  '3': ['###', '..#', '.##', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '5': ['###', '#..', '###', '..#', '###'],
  '6': ['###', '#..', '###', '#.#', '###'],
  '7': ['###', '..#', '.#.', '.#.', '.#.'],
  '8': ['###', '#.#', '###', '#.#', '###'],
  '9': ['###', '#.#', '###', '..#', '###'],
  M: ['#.#', '###', '###', '#.#', '#.#'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
  N: ['#.#', '###', '###', '###', '#.#'],
  G: ['###', '#..', '#.#', '#.#', '###'],
  O: ['###', '#.#', '#.#', '#.#', '###'],
  '!': ['.#.', '.#.', '.#.', '...', '.#.'],
  F: ['###', '#..', '##.', '#..', '#..'],
  A: ['###', '#.#', '###', '#.#', '#.#'],
  S: ['###', '#..', '###', '..#', '###'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  P: ['###', '#.#', '###', '#..', '#..'],
  E: ['###', '#..', '##.', '#..', '###'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  L: ['#..', '#..', '#..', '#..', '###'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
  W: ['#.#', '#.#', '###', '###', '#.#'],
  ' ': ['...', '...', '...', '...', '...'],
};

/** Draw text in the 3x5 font; returns width in px. */
export function text(m: IndexMap, x: number, y: number, s: string, v: number): number {
  let cx = x;
  for (const ch of s) {
    const g = GLYPHS[ch];
    if (!g) throw new Error(`no glyph ${ch}`);
    g.forEach((row, yy) => {
      for (let xx = 0; xx < 3; xx++) if (row[xx] === '#') setPx(m, cx + xx, y + yy, v);
    });
    cx += 4;
  }
  return cx - x - 1;
}

export function textWidth(s: string): number {
  return s.length * 4 - 1;
}
