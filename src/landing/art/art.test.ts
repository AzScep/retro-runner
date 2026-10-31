import { describe, expect, it } from 'vitest';
import { TUNING, type CharacterId } from '../../core/index.ts';
import {
  characterAnims,
  characterFrames,
  clipFrameAt,
  eventIconUrl,
  hurdleJumpClip,
  HURDLE_LOOP,
  JUMP_ARC,
  LANDING_CHARACTERS,
  LANDING_EVENTS,
  LANDING_RIVALS,
  LANDING_TIERS,
  meetBadgeUrl,
  portraitMap,
  portraitUrl,
  stadiumLayers,
  stadiumScene,
  stadiumSceneUrl,
  type CharacterAnim,
  type IndexMap,
  type LandingTier,
} from './index.ts';

/** Width and height from a data URL's PNG IHDR. */
function pngSize(url: string): [number, number] {
  const bin = atob(url.slice('data:image/png;base64,'.length));
  const u32 = (o: number) =>
    ((bin.charCodeAt(o) << 24) |
      (bin.charCodeAt(o + 1) << 16) |
      (bin.charCodeAt(o + 2) << 8) |
      bin.charCodeAt(o + 3)) >>>
    0;
  expect(bin.slice(12, 16)).toBe('IHDR');
  return [u32(16), u32(20)];
}

function opaque(m: IndexMap): number {
  return m.data.reduce((n, v) => n + (v ? 1 : 0), 0);
}

const BASE_ANIMS: readonly CharacterAnim[] = [
  'idle',
  'walk',
  'ready',
  'run',
  'lean',
  'celebrate',
  'lose',
  'stumble',
];
/** Design 5.6 frame counts. */
const FRAME_COUNTS: Readonly<Partial<Record<CharacterAnim, number>>> = {
  idle: 4,
  walk: 6,
  ready: 2,
  run: 8,
  lean: 2,
  celebrate: 6,
  lose: 4,
  stumble: 3,
  hurdle: 4,
  tired: 8,
};

describe('characterFrames', () => {
  it('gives every landing character every base anim as 48x48 frames with design frame counts', () => {
    for (const id of LANDING_CHARACTERS) {
      for (const anim of BASE_ANIMS) {
        const clip = characterFrames(id, anim);
        expect(clip.w, `${id}.${anim}`).toBe(48);
        expect(clip.h).toBe(48);
        expect([clip.pivotX, clip.pivotY]).toEqual([24, 47]);
        expect(clip.frames.length, `${id}.${anim}`).toBe(FRAME_COUNTS[anim]);
        for (const f of clip.frames) {
          expect([f.w, f.h]).toEqual([48, 48]);
          expect(opaque(f), `${id}.${anim}`).toBeGreaterThan(100);
        }
      }
    }
  });

  it('has the extras the sections use, and refuses ones a character lacks', () => {
    expect(characterFrames('rio', 'tired').frames).toHaveLength(8);
    expect(characterFrames('rio', 'run').loop).toBe(true);
    expect(characterFrames('rio', 'lean').loop).toBe(false);
    for (const id of LANDING_CHARACTERS.filter((c) => c !== 'sol')) {
      expect(characterFrames(id, 'hurdle').frames, id).toHaveLength(4);
    }
    expect(() => characterFrames('sol', 'hurdle')).toThrow(RangeError);
    expect(() => characterFrames('pip', 'tired')).toThrow(RangeError);
    expect(characterAnims('pip')).toContain('wave');
  });

  it('caches clips', () => {
    expect(characterFrames('pip', 'run')).toBe(characterFrames('pip', 'run'));
  });

  it('never animates Zyx', () => {
    expect(LANDING_CHARACTERS).not.toContain('zyx');
    const zyx = 'zyx' as unknown as 'rio';
    expect(() => characterFrames(zyx, 'idle')).toThrow(RangeError);
    expect(() => characterAnims(zyx)).toThrow(RangeError);
    expect(() => hurdleJumpClip(zyx)).toThrow(RangeError);
  });
});

describe('hurdleJumpClip', () => {
  it('uses the game jump arc', () => {
    expect(JUMP_ARC).toEqual({ airMs: TUNING.JUMP_AIR_MS, peakM: TUNING.JUMP_PEAK_M });
  });

  it('loops the run, the arc and the hurdle in a fixed box without clipping the runner', () => {
    const clip = hurdleJumpClip('rio');
    expect(clip.loop).toBe(true);
    expect(clip.frames.length).toBe(HURDLE_LOOP.runIn + 5 + HURDLE_LOOP.runOut);
    // Every runner pixel stays inside: no frame touches the top edge.
    for (const f of clip.frames) {
      expect([f.w, f.h]).toEqual([HURDLE_LOOP.w, HURDLE_LOOP.h]);
      for (let x = 0; x < f.w; x++) expect(f.data[x], 'top row').toBe(0);
    }
    // Mid-air the runner is raised: its highest pixel is well above the grounded one.
    const top = (m: IndexMap) => Math.floor(m.data.findIndex((v) => v !== 0) / m.w);
    expect(top(clip.frames[0]!) - top(clip.frames[HURDLE_LOOP.runIn + 2]!)).toBeGreaterThan(20);
    expect(() => hurdleJumpClip('sol' as 'rio')).toThrow(RangeError);
  });
});

describe('clipFrameAt', () => {
  const clip = { ...characterFrames('rio', 'run') };
  it('wraps loops and holds one-shots on the last frame', () => {
    expect(clipFrameAt(clip, 0)).toBe(0);
    expect(clipFrameAt(clip, 1000 / 12)).toBe(1);
    expect(clipFrameAt(clip, (9 * 1000) / 12)).toBe(1);
    expect(clipFrameAt(clip, 500, 24)).toBe(4);
    const lean = characterFrames('rio', 'lean');
    expect(clipFrameAt(lean, 10_000)).toBe(1);
    expect(clipFrameAt(lean, -50)).toBe(0);
  });
});

describe('portraitUrl', () => {
  it('renders every rival and Rio at both sizes, unlocked and locked, at the requested scale', () => {
    for (const id of ['rio', ...LANDING_RIVALS] as const) {
      for (const size of [16, 48] as const) {
        for (const locked of [false, true]) {
          expect(pngSize(portraitUrl(id, size, locked)), `${id} ${size}`).toEqual([size, size]);
          expect(pngSize(portraitUrl(id, size, locked, 3))).toEqual([size * 3, size * 3]);
        }
      }
    }
  });

  it('shows Zyx only as the black silhouette: nothing but ink indices 1 and 3', () => {
    for (const size of [16, 48] as const) {
      const m = portraitMap('zyx', size, true);
      expect(opaque(m)).toBeGreaterThan(size * 2);
      const used = new Set(m.data);
      used.delete(0);
      expect([...used].sort()).toEqual([1, 3]);
      expect(pngSize(portraitUrl('zyx', size, true, 2))).toEqual([size * 2, size * 2]);
    }
  });

  it('refuses an unlocked Zyx', () => {
    const zyx = 'zyx' as CharacterId as 'rio';
    expect(() => portraitUrl(zyx, 48)).toThrow(RangeError);
    expect(() => portraitUrl(zyx, 16, false)).toThrow(RangeError);
    expect(() => portraitMap('zyx', 48, false)).toThrow(RangeError);
  });

  it('rejects non-integer scales', () => {
    expect(() => portraitUrl('pip', 48, false, 1.5)).toThrow(RangeError);
    expect(() => portraitUrl('pip', 48, false, 0)).toThrow(RangeError);
  });
});

describe('meet badges, event icons and stadiums', () => {
  it('renders the six meet badges at 16x16', () => {
    for (const tier of LANDING_TIERS) {
      expect(pngSize(meetBadgeUrl(tier)), `tier ${tier}`).toEqual([16, 16]);
      expect(pngSize(meetBadgeUrl(tier, 4))).toEqual([64, 64]);
    }
  });

  it('renders each event pictogram at 32 and 16', () => {
    for (const ev of LANDING_EVENTS) {
      expect(pngSize(eventIconUrl(ev))).toEqual([32, 32]);
      expect(pngSize(eventIconUrl(ev, 16, 2))).toEqual([32, 32]);
    }
  });

  it('builds each tier 1-6 as six layers and an opaque 320x180 scene', () => {
    for (const tier of LANDING_TIERS) {
      const layers = stadiumLayers(tier);
      expect(layers.map((l) => l.name)).toEqual(['sky', 'far', 'stands', 'near', 'track', 'fg']);
      expect(layers.find((l) => l.name === 'stands')?.alt).toBeDefined();
      const scene = stadiumScene(tier);
      expect([scene.w, scene.h]).toEqual([320, 180]);
      expect(scene.data.every((v) => v !== 0)).toBe(true);
      expect(pngSize(stadiumSceneUrl(tier, { width: 200, scale: 2 }))).toEqual([400, 360]);
    }
  });

  it('scrolls the scene with whole-pixel parallax', () => {
    const a = stadiumScene(3, { scroll: 0 });
    const b = stadiumScene(3, { scroll: 64 });
    // The track tile is 64 px wide at factor 1, so its rows repeat exactly after 64 px of scroll.
    const row = 140 * 320;
    expect(b.data.slice(row, row + 320)).toEqual(a.data.slice(row, row + 320));
    // The sky never moves; the crowd does.
    expect(b.data.slice(0, 320 * 20)).toEqual(a.data.slice(0, 320 * 20));
    expect(b.data.slice(70 * 320, 71 * 320)).not.toEqual(a.data.slice(70 * 320, 71 * 320));
  });

  it('cannot produce tier 7 (or any tier outside 1-6) art', () => {
    for (const bad of [7, 0, 8, 3.5, -1, Number.NaN]) {
      const t = bad as LandingTier;
      expect(() => meetBadgeUrl(t), String(bad)).toThrow(RangeError);
      expect(() => stadiumLayers(t), String(bad)).toThrow(RangeError);
      expect(() => stadiumScene(t), String(bad)).toThrow(RangeError);
      expect(() => stadiumSceneUrl(t), String(bad)).toThrow(RangeError);
    }
    expect(LANDING_TIERS).not.toContain(7);
  });
});
