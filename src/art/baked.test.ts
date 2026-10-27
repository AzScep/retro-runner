import { describe, expect, it } from 'vitest';
import { toRGBA } from './bake/index.ts';
import { ATLAS_MAX, bakeArt, bakeField, bakeMain, FIELD_PAGE_MAX, KEYS } from './baked.ts';
import { buildIcon } from './sprites/icons.ts';
import { groundShadow } from './stadium/layers.ts';

describe('bakeArt (one atlas page: shared art, then the field below it)', () => {
  const art = bakeArt();
  const main = art.pages[0]!;

  it('bakes one page within the GL budget, with room for the largest field page (design 35.1)', () => {
    expect(art.pages.map((p) => p.key)).toEqual([KEYS.atlas]);
    expect(main.data.length).toBe(main.w * main.h * 4);
    expect(main.w).toBeLessThanOrEqual(ATLAS_MAX);
    expect(main.h).toBeLessThanOrEqual(ATLAS_MAX);
    const field = bakeField().pages[0]!;
    expect(field.w).toBeLessThanOrEqual(FIELD_PAGE_MAX.w);
    expect(field.h).toBeLessThanOrEqual(FIELD_PAGE_MAX.h);
    // Shared art plus a full-size field page still fits one page.
    expect(bakeMain().pages[0]!.h + 1 + FIELD_PAGE_MAX.h).toBeLessThanOrEqual(ATLAS_MAX);
    // Field runner frames sit below every other key; their portraits stay with the shared art.
    const fieldTop = Math.min(...art.textures.filter((t) => t.key.startsWith('fchar.')).map((t) => t.y));
    for (const t of art.textures) {
      expect(t.page, t.key).toBe(0);
      if (!t.key.startsWith('fchar.')) expect(t.y + t.h, t.key).toBeLessThan(fieldTop);
    }
  });

  it('gives every key a unique rect inside its page, with frames inside their rect', () => {
    const keys = new Set<string>();
    for (const t of art.textures) {
      const page = art.pages[t.page]!;
      expect(keys.has(t.key), t.key).toBe(false);
      keys.add(t.key);
      expect(t.x + t.w).toBeLessThanOrEqual(page.w);
      expect(t.y + t.h).toBeLessThanOrEqual(page.h);
      for (const f of t.frames) {
        expect(f.x + f.w, `${t.key}/${f.name}`).toBeLessThanOrEqual(t.w);
        expect(f.y + f.h, `${t.key}/${f.name}`).toBeLessThanOrEqual(t.h);
      }
    }
    expect(keys.has(KEYS.char('rio'))).toBe(true);
    expect(keys.has(KEYS.layer(7, 'stands1'))).toBe(true);
    expect(keys.has(KEYS.atlas)).toBe(false);
    expect(keys.has(KEYS.fieldChar('fDrone', 'D'))).toBe(true);
  });

  it('only animates frames that exist on the animated texture', () => {
    const frames = new Map(art.textures.map((t) => [t.key, new Set(t.frames.map((f) => f.name))]));
    expect(art.anims.length).toBeGreaterThan(0);
    for (const a of art.anims) {
      for (const f of a.frames) {
        // No frame name means the texture's own __BASE frame.
        if (f.frame === undefined) expect(frames.has(f.key), `${a.key}: ${f.key}`).toBe(true);
        else expect(frames.get(f.key)?.has(f.frame), `${a.key}: ${f.key}/${f.frame}`).toBe(true);
      }
    }
  });

  it('stores each map with the same pixels a standalone texture had', () => {
    for (const [key, map] of [
      [KEYS.icon('trophy'), buildIcon('trophy')],
      [KEYS.shadow, groundShadow()],
    ] as const) {
      const t = art.textures.find((x) => x.key === key)!;
      const want = toRGBA(map);
      for (let y = 0; y < t.h; y++) {
        const row = main.data.subarray(((t.y + y) * main.w + t.x) * 4, ((t.y + y) * main.w + t.x + t.w) * 4);
        expect(Array.from(row), `${key} row ${y}`).toEqual(
          Array.from(want.subarray(y * t.w * 4, (y + 1) * t.w * 4)),
        );
      }
    }
  });
});
