/**
 * 16x16 effects (design 5.5, 5.6): dust puff, sparks, exhaust puff, warp ring, flashbulb,
 * sweat drop, gum bubble. Pure.
 */
import { createMap, outline, setPx, type IndexMap } from '../bake/index.ts';
import { ellipse, line, rect } from '../paint.ts';

export type FxName = 'dust' | 'spark' | 'exhaust' | 'warpRing' | 'flash' | 'sweat' | 'gum';

export interface FxDef {
  readonly name: FxName;
  readonly fps: number;
  readonly repeat: number;
  readonly frames: readonly IndexMap[];
}

const S = 16;
const DUST: readonly [number, number, number, number] = [6, 6, 7, 8];
const SMOKE: readonly [number, number, number, number] = [3, 4, 5, 6];

function dust(i: number): IndexMap {
  const m = createMap(S, S);
  // Puff kicks up and back (left) from the foot at the bottom centre.
  const puffs: (readonly [number, number, number])[][] = [
    [
      [8, 13, 2.2],
      [5.5, 14, 1.6],
    ],
    [
      [7.5, 11.5, 3],
      [4, 13, 2.2],
      [10.5, 13.5, 1.6],
    ],
    [
      [7, 10, 3.2],
      [3.5, 12, 2.4],
      [10.5, 12.5, 2],
    ],
    [
      [6.5, 8.5, 1.6],
      [3, 11, 1.2],
      [10.5, 11, 1.2],
    ],
  ];
  for (const [x, y, r] of puffs[i] ?? []) ellipse(m, x, y, r, r * 0.85, DUST, 0.35, -0.35);
  return i < 3 ? outline(m, { color: 6 }) : m;
}

function spark(i: number): IndexMap {
  const m = createMap(S, S);
  const c = 7.5;
  const rays: readonly (readonly [number, number])[] = [
    [1, -1],
    [-1, -0.6],
    [0.4, 1],
    [-0.8, 1],
    [1, 0.3],
    [0, -1],
  ];
  const len = [2, 5, 6, 0][i] ?? 0;
  const from = [0, 1, 3, 0][i] ?? 0;
  for (const [dx, dy] of rays) {
    line(m, c + dx * from, c + dy * from, c + dx * len, c + dy * len, i === 1 ? 23 : 22);
    if (len) setPx(m, Math.round(c + dx * len), Math.round(c + dy * len), i === 2 ? 21 : 8);
  }
  if (i === 0) {
    rect(m, 6, 6, 3, 3, 23);
    setPx(m, 7, 7, 8);
  }
  if (i === 3) {
    for (const [dx, dy] of rays) setPx(m, Math.round(c + dx * 7), Math.round(c + dy * 7 + 1), 21);
  }
  return m;
}

function exhaust(i: number): IndexMap {
  const m = createMap(S, S);
  const r = [1.6, 2.5, 3.2, 2.6][i] ?? 2;
  const x = [11, 9, 7, 5][i] ?? 8;
  const y = [10, 8.5, 7, 5][i] ?? 8;
  ellipse(m, x, y, r, r * 0.9, SMOKE, 0.35, -0.35);
  if (i >= 1) ellipse(m, x + r * 0.9, y + r * 0.6, r * 0.6, r * 0.55, SMOKE);
  return i < 3 ? outline(m, { color: 3 }) : m;
}

function warpRing(i: number): IndexMap {
  const m = createMap(S, S);
  const rx = [1.5, 3, 4.5, 6, 7, 7.5][i] ?? 7;
  const ry = Math.min(7.5, rx * 1.15 + 0.5);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x + 0.5 - 8) / rx;
      const dy = (y + 0.5 - 8) / ry;
      const d = Math.sqrt(dx * dx + dy * dy);
      const thick = i < 4 ? 1.4 / rx : 1 / rx;
      if (Math.abs(d - 1) < thick) setPx(m, x, y, i >= 4 ? 36 : d < 1 ? 37 : 36);
    }
  }
  if (i === 0) rect(m, 7, 6, 2, 4, 37);
  if (i === 5) {
    // Break the ring into twinkles.
    for (let k = 0; k < m.data.length; k++) if (m.data[k] && k % 3 !== 0) m.data[k] = 0;
  }
  return m;
}

function flash(i: number): IndexMap {
  const m = createMap(S, S);
  if (i === 0) {
    rect(m, 7, 7, 2, 2, 8);
    rect(m, 6, 7, 1, 2, 23);
    rect(m, 9, 7, 1, 2, 23);
  } else if (i === 1) {
    line(m, 8, 1, 8, 14, 23);
    line(m, 1, 8, 14, 8, 23);
    line(m, 4, 4, 11, 11, 41);
    line(m, 11, 4, 4, 11, 41);
    rect(m, 6, 6, 4, 4, 8);
    line(m, 7, 3, 7, 12, 8);
    line(m, 3, 7, 12, 7, 8);
  } else {
    line(m, 7, 4, 7, 10, 23);
    line(m, 4, 7, 10, 7, 23);
    setPx(m, 7, 7, 8);
  }
  return m;
}

function sweat(i: number): IndexMap {
  const m = createMap(S, S);
  const y = 3 + i * 3;
  const x = 7 - i;
  setPx(m, x + 1, y, 31);
  rect(m, x, y + 1, 3, 2, 31);
  setPx(m, x + 1, y + 1, 8);
  rect(m, x, y + 3, 3, 1, 30);
  setPx(m, x + 1, y + 4, 30);
  return outline(m, { color: 28 });
}

function gum(i: number): IndexMap {
  const m = createMap(S, S);
  if (i < 3) {
    const r = [1.5, 2.6, 3.6][i] ?? 2;
    ellipse(m, 3 + r, 8, r, r, [16, 41, 41, 8], 0.55, -0.6);
    return outline(m, { color: 16 });
  }
  // Pop: a few shreds.
  for (const [x, y] of [
    [3, 6],
    [6, 4],
    [9, 6],
    [4, 10],
    [8, 10],
  ] as const) {
    rect(m, x, y, 2, 1, 41);
  }
  return m;
}

const FRAMES = (n: number, fn: (i: number) => IndexMap) => Array.from({ length: n }, (_, i) => fn(i));

export function buildEffects(): readonly FxDef[] {
  return [
    { name: 'dust', fps: 16, repeat: 0, frames: FRAMES(4, dust) },
    { name: 'spark', fps: 12, repeat: 0, frames: FRAMES(4, spark) },
    { name: 'exhaust', fps: 12, repeat: 0, frames: FRAMES(4, exhaust) },
    { name: 'warpRing', fps: 20, repeat: 0, frames: FRAMES(6, warpRing) },
    { name: 'flash', fps: 12, repeat: 0, frames: FRAMES(3, flash) },
    { name: 'sweat', fps: 8, repeat: 0, frames: FRAMES(3, sweat) },
    { name: 'gum', fps: 6, repeat: -1, frames: FRAMES(4, gum) },
  ];
}
