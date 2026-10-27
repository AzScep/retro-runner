import { describe, expect, it } from 'vitest';
import { packAtlas, writeRGBA } from './atlas.ts';
import { createMap, fromFn, setPx, toRGBA } from './index.ts';

const overlaps = (
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('packAtlas', () => {
  it('places every rect inside the page with a gap between neighbours', () => {
    const sizes = [
      { w: 384, h: 288 },
      { w: 480, h: 20 },
      { w: 16, h: 16 },
      { w: 320, h: 48 },
      { w: 6, h: 4 },
      { w: 128, h: 44 },
      { w: 384, h: 240 },
    ];
    for (let n = 0; n < 40; n++) sizes.push({ w: 1 + ((n * 37) % 300), h: 1 + ((n * 53) % 90) });
    const { w, h, slots } = packAtlas(sizes, 1024, 1);
    expect(slots).toHaveLength(sizes.length);
    const rects = sizes.map((s, i) => ({ ...slots[i]!, ...s }));
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(w);
      expect(r.y + r.h).toBeLessThanOrEqual(h);
    }
    expect(w).toBeLessThanOrEqual(1024);
    // Grown by the 1 px pad, no two rects may touch.
    const padded = rects.map((r) => ({ x: r.x, y: r.y, w: r.w + 1, h: r.h + 1 }));
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) expect(overlaps(padded[i]!, rects[j]!)).toBe(false);
    }
  });

  it('is deterministic and rejects rects wider than the page', () => {
    const sizes = [
      { w: 10, h: 5 },
      { w: 10, h: 5 },
      { w: 4, h: 9 },
    ];
    expect(packAtlas(sizes)).toEqual(packAtlas(sizes));
    expect(() => packAtlas([{ w: 33, h: 1 }], 32)).toThrow();
  });
});

describe('writeRGBA', () => {
  it('writes the same bytes as toRGBA at the given offset and leaves the rest untouched', () => {
    const map = fromFn(5, 3, (x, y) => ((x + y) % 4 === 0 ? 0 : 1 + ((x * 7 + y * 3) % 42)));
    const pageW = 9;
    const page = new Uint8Array(pageW * 6 * 4);
    writeRGBA(page, pageW, map, 3, 2);
    const ref = toRGBA(map);
    for (let y = 0; y < 6; y++) {
      for (let x = 0; x < pageW; x++) {
        const got = Array.from(page.slice((y * pageW + x) * 4, (y * pageW + x) * 4 + 4));
        const inside = x >= 3 && x < 8 && y >= 2 && y < 5;
        const i = ((y - 2) * 5 + (x - 3)) * 4;
        expect(got).toEqual(inside ? Array.from(ref.slice(i, i + 4)) : [0, 0, 0, 0]);
      }
    }
  });

  it('rejects indices outside the palette', () => {
    const map = createMap(1, 1);
    setPx(map, 0, 0, 99);
    expect(() => writeRGBA(new Uint8Array(4), 1, map, 0, 0)).toThrow();
  });
});
