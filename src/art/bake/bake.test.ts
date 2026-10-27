import { describe, expect, it } from 'vitest';
import designMd from '../../../docs/design.md?raw';
import { PALETTE, PALETTE_SIZE, RAMP_DARKEST, paletteColor } from '../palette.ts';
import {
  createMap,
  flipH,
  outline,
  packSheet,
  parseRows,
  remap,
  setPx,
  silhouette,
  toRGBA,
} from './index.ts';

const rowsOf = (m: { w: number; h: number; data: Uint8Array }) =>
  Array.from({ length: m.h }, (_, y) =>
    Array.from(m.data.slice(y * m.w, y * m.w + m.w))
      .map((v) => (v === 0 ? '.' : v.toString(36)))
      .join(''),
  );

describe('palette (design 5.2)', () => {
  it('matches the design table exactly, index for index', () => {
    const rows = [...designMd.matchAll(/^\| (\d+) \| [^|]+\| `#([0-9a-f]{6})` \|/gm)];
    expect(rows).toHaveLength(42);
    for (const [, idx, hex] of rows) expect(PALETTE[Number(idx)]).toBe(parseInt(hex as string, 16));
    expect(PALETTE_SIZE).toBe(43);
  });

  it('paletteColor validates its index', () => {
    expect(paletteColor(22)).toBe(0xffd23f);
    expect(() => paletteColor(43)).toThrow();
    expect(() => paletteColor(-1)).toThrow();
    expect(() => paletteColor(1.5)).toThrow();
  });

  it('every ramp darkest tone is a palette index', () => {
    expect(RAMP_DARKEST).toHaveLength(43);
    for (const v of RAMP_DARKEST) expect(v).toBeLessThan(43);
  });
});

describe('parseRows', () => {
  it('rejects ragged rows and unknown characters', () => {
    expect(() => parseRows(['ab', 'a'], { a: 1, b: 2 })).toThrow(/length/);
    expect(() => parseRows(['az'], { a: 1 })).toThrow(/unknown/);
  });
  it('maps legend characters and treats . as transparent', () => {
    const m = parseRows(['a.', '.b'], { a: 5, b: 7 });
    expect(Array.from(m.data)).toEqual([5, 0, 0, 7]);
  });
});

describe('outline (design 5.3)', () => {
  it('adds a 1 px 4-connected ring in index 1 and nothing on diagonals', () => {
    const m = createMap(5, 5);
    setPx(m, 2, 2, 18);
    expect(rowsOf(outline(m))).toEqual(['.....', '..1..', '.1i1.', '..1..', '.....']);
  });

  it('never doubles: an outlined shape gets exactly one ring', () => {
    const m = parseRows(['......', '.aaaa.', '.aaaa.', '......'], { a: 12 });
    const o = outline(m);
    expect(rowsOf(o)).toEqual(['.1111.', '1cccc1', '1cccc1', '.1111.']);
  });

  it('selective outline only recolours the lit top/left edges', () => {
    const m = parseRows(['.....', '.aa..', '.aa..', '.....'], { a: 18 });
    const o = outline(m, { selout: true });
    // Top and left use red darkest (16 = 'g'); bottom and right stay index 1.
    expect(rowsOf(o)).toEqual(['.gg..', 'gii1.', 'gii1.', '.11..']);
  });
});

describe('helpers', () => {
  it('remap leaves transparency alone', () => {
    const m = parseRows(['a.'], { a: 36 });
    expect(Array.from(remap(m, { 36: 18, 0: 5 }).data)).toEqual([18, 0]);
  });
  it('silhouette fills and rims', () => {
    const m = parseRows(['aaa', 'aaa', 'aaa'], { a: 12 });
    expect(rowsOf(silhouette(m, 1, 3))).toEqual(['333', '313', '333']);
  });
  it('toRGBA writes opaque palette colours and transparent zeros', () => {
    const m = parseRows(['a.'], { a: 22 });
    expect(Array.from(toRGBA(m))).toEqual([0xff, 0xd2, 0x3f, 255, 0, 0, 0, 0]);
  });
  it('flipH mirrors', () => {
    expect(rowsOf(flipH(parseRows(['ab.'], { a: 1, b: 2 })))).toEqual(['.21']);
  });
  it('packSheet lays frames in a grid', () => {
    const f = (v: number) => ({ name: `f${v}`, map: parseRows(['a'], { a: v }) });
    const s = packSheet([f(1), f(2), f(3)], 2);
    expect(s.map.w).toBe(2);
    expect(s.map.h).toBe(2);
    expect(s.rects.map((r) => [r.x, r.y])).toEqual([
      [0, 0],
      [1, 0],
      [0, 1],
    ]);
  });
});
