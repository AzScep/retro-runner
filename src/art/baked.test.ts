import { describe, expect, it } from 'vitest';
import { toRGBA } from './bake/index.ts';
import { bakeArt, KEYS } from './baked.ts';
import { buildIcon } from './sprites/icons.ts';
import { groundShadow } from './stadium/layers.ts';

describe('bakeArt (one atlas page for all art)', () => {
  const art = bakeArt();

  it('gives every key a unique rect inside the page, with frames inside their rect', () => {
    expect(art.page.length).toBe(art.w * art.h * 4);
    expect(art.w).toBeLessThanOrEqual(2048);
    const keys = new Set<string>();
    for (const t of art.textures) {
      expect(keys.has(t.key), t.key).toBe(false);
      keys.add(t.key);
      expect(t.x + t.w).toBeLessThanOrEqual(art.w);
      expect(t.y + t.h).toBeLessThanOrEqual(art.h);
      for (const f of t.frames) {
        expect(f.x + f.w, `${t.key}/${f.name}`).toBeLessThanOrEqual(t.w);
        expect(f.y + f.h, `${t.key}/${f.name}`).toBeLessThanOrEqual(t.h);
      }
    }
    expect(keys.has(KEYS.char('rio'))).toBe(true);
    expect(keys.has(KEYS.layer(7, 'stands1'))).toBe(true);
    expect(keys.has(KEYS.atlas)).toBe(false);
  });

  it('only animates frames that exist on the animated texture', () => {
    const frames = new Map(art.textures.map((t) => [t.key, new Set(t.frames.map((f) => f.name))]));
    expect(art.anims.length).toBeGreaterThan(0);
    for (const a of art.anims) {
      for (const f of a.frames) expect(frames.get(a.texture)?.has(f), `${a.key}: ${f}`).toBe(true);
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
        const row = art.page.subarray(((t.y + y) * art.w + t.x) * 4, ((t.y + y) * art.w + t.x + t.w) * 4);
        expect(Array.from(row), `${key} row ${y}`).toEqual(
          Array.from(want.subarray(y * t.w * 4, (y + 1) * t.w * 4)),
        );
      }
    }
  });
});
