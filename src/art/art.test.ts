import { describe, expect, it } from 'vitest';
import { OPPONENT_IDS, WORLD, type RunnerState } from '../core/index.ts';
import { getPx, validIndices, type IndexMap } from './bake/index.ts';
import { buildCharacter, CHARACTER_IDS } from './chars/index.ts';
import { ANIM_FRAME_COUNTS, ANIMS } from './chars/poses.ts';
import { buildEffects } from './sprites/effects.ts';
import { buildIcon, ICON_NAMES, iconSize, keyIcon } from './sprites/icons.ts';
import { lockedPortrait, portrait16, portrait48 } from './sprites/portraits.ts';
import {
  distanceBoard,
  FAR_SAFE_ROW,
  farLayer,
  fgLayer,
  finishLine,
  groundShadow,
  LAYERS,
  nearLayer,
  skyLayer,
  standsLayer,
  TIERS,
  trackLayer,
} from './stadium/layers.ts';
import { cameraScroll, FINISH_X_PX, MAX_SCROLL, VIEW, worldX } from './view/camera.ts';
import { blocksOffsetPx, pickRunnerView, READY_SHIFT_PX } from './view/runner.ts';

const ARTS = CHARACTER_IDS.map((id) => buildCharacter(id));

function opaqueBounds(m: IndexMap) {
  let minX = m.w;
  let minY = m.h;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < m.h; y++) {
    for (let x = 0; x < m.w; x++) {
      if (!getPx(m, x, y)) continue;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  return { minX, minY, maxX, maxY };
}

describe('characters (design 5.5, 5.6)', () => {
  it('covers rio and every opponent', () => {
    expect([...CHARACTER_IDS].sort()).toEqual(['rio', ...OPPONENT_IDS].sort());
  });

  it.each(ARTS.map((a) => [a.id, a] as const))('%s has every anim with the design frame counts', (_, art) => {
    for (const [name, n] of Object.entries(ANIM_FRAME_COUNTS)) {
      const anim = art.anims.find((a) => a.name === name);
      expect(anim?.frames, name).toHaveLength(n);
    }
    const base = art.anims
      .filter((a) => a.name in ANIM_FRAME_COUNTS)
      .reduce((s, a) => s + a.frames.length, 0);
    // Design 5.6 says "33 per character" but its own table sums to 35 (4+6+2+8+2+6+4+3).
    expect(base).toBe(Object.values(ANIM_FRAME_COUNTS).reduce((a, b) => a + b, 0));
    expect(base).toBe(35);
    for (const a of art.anims)
      for (const f of a.frames) expect(art.frames.some((fr) => fr.name === f)).toBe(true);
  });

  it('has the character extras with design frame counts', () => {
    const count = (id: string, name: string) =>
      ARTS.find((a) => a.id === id)?.anims.find((a) => a.name === name)?.frames.length;
    expect(count('pip', 'wave')).toBe(4);
    expect(count('zyx', 'warpOut')).toBe(6);
    expect(count('zyx', 'warpIn')).toBe(6);
    expect(count('unit7', 'runOc')).toBe(8);
    expect(count('marco', 'runLook')).toBe(8);
  });

  it.each(ARTS.map((a) => [a.id, a] as const))(
    '%s frames are 48x48, in palette, outlined and unclipped',
    (_, art) => {
      for (const f of art.frames) {
        const m = f.map;
        expect([m.w, m.h], f.name).toEqual([48, 48]);
        expect(validIndices(m), f.name).toBe(true);
        if (f.name.startsWith('warp')) continue;
        const b = opaqueBounds(m);
        // A 1 px transparent margin on top/left/right means nothing was clipped; row 47 holds the outline under the feet.
        expect(b.minY, `${f.name} top`).toBeGreaterThanOrEqual(1);
        expect(b.minX, `${f.name} left`).toBeGreaterThanOrEqual(1);
        expect(b.maxX, `${f.name} right`).toBeLessThanOrEqual(46);
        expect(b.maxY, `${f.name} bottom`).toBeLessThanOrEqual(47);
        // Outer outline: every opaque pixel touching transparency (or the border) is index 1.
        for (let y = 0; y < 48; y++) {
          for (let x = 0; x < 48; x++) {
            const v = getPx(m, x, y);
            if (!v) continue;
            const edge =
              !getPx(m, x - 1, y) || !getPx(m, x + 1, y) || !getPx(m, x, y - 1) || !getPx(m, x, y + 1);
            if (edge) expect(v, `${f.name} @${x},${y}`).toBe(1);
          }
        }
      }
    },
  );

  it('grounded frames put the feet on row 46 with the outline on row 47', () => {
    for (const art of ARTS) {
      for (const name of ['idle0', 'walk0', 'run0', 'ready0', 'lose0']) {
        const m = art.frames.find((f) => f.name === name)?.map as IndexMap;
        expect(opaqueBounds(m).maxY, `${art.id} ${name}`).toBe(47);
      }
    }
  });

  it('sizes characters per design: adults ~40 px, Pip ~30 px, Zyx ~44 px', () => {
    const height = (id: string) => {
      const m = ARTS.find((a) => a.id === id)?.frames.find((f) => f.name === 'idle0')?.map as IndexMap;
      const b = opaqueBounds(m);
      return b.maxY - b.minY - 1; // without outline
    };
    for (const id of ['rio', 'jess', 'marco', 'kofi', 'valentina', 'unit7']) {
      expect(height(id), id).toBeGreaterThanOrEqual(37);
      expect(height(id), id).toBeLessThanOrEqual(42);
    }
    expect(height('pip')).toBeGreaterThanOrEqual(27);
    expect(height('pip')).toBeLessThanOrEqual(32);
    expect(height('zyx')).toBeGreaterThanOrEqual(42);
    expect(height('zyx')).toBeLessThanOrEqual(46);
  });

  it('waits behind the start line in the blocks (design 5.6 ready, start line at the pivot)', () => {
    // The pivot column (24) sits on the start line at 0 m; ready frames are drawn READY_SHIFT_PX back.
    expect(blocksOffsetPx(-1)).toBe(-READY_SHIFT_PX);
    expect(blocksOffsetPx(0)).toBe(-READY_SHIFT_PX);
    expect(blocksOffsetPx(10)).toBe(0);
    for (const art of ARTS) {
      for (const name of ['ready0', 'ready1']) {
        const m = art.frames.find((f) => f.name === name)?.map as IndexMap;
        expect(opaqueBounds(m).maxX - READY_SHIFT_PX, `${art.id} ${name}`).toBeLessThanOrEqual(23);
      }
    }
  });

  it('set pose raises the hips above the shoulders, on-marks keeps them lower', () => {
    const marks = ANIMS.find((a) => a.name === 'ready')?.poses[0];
    const set = ANIMS.find((a) => a.name === 'ready')?.poses[1];
    // Torso lean past 90 degrees means the neck end is lower than the hips.
    expect(set?.lean).toBeGreaterThan(90);
    expect(marks?.lean).toBeLessThan(90);
  });

  it('celebrate jumps: feet leave the ground mid-loop and land on the last frame', () => {
    for (const art of ARTS) {
      const bottom = (n: string) => opaqueBounds(art.frames.find((f) => f.name === n)?.map as IndexMap).maxY;
      expect(bottom('celebrate0'), art.id).toBe(47);
      // Zyx is 44 px tall, so the frame leaves him only a small hop.
      expect(bottom('celebrate2'), art.id).toBeLessThan(art.id === 'zyx' ? 47 : 44);
      expect(bottom('celebrate5'), art.id).toBe(47);
    }
  });

  it('run cycle is 8 distinct frames', () => {
    for (const art of ARTS) {
      const keys = new Set(
        art.frames.filter((f) => /^run\d$/.test(f.name)).map((f) => Array.from(f.map.data).join(',')),
      );
      expect(keys.size, art.id).toBe(8);
    }
    expect(ANIMS.find((a) => a.name === 'run')?.repeat).toBe(-1);
  });
});

describe('portraits and icons (design 5.5, 6.2, 6.7)', () => {
  it.each(CHARACTER_IDS.map((id) => [id]))('%s portraits are 16x16 and 48x48 with silhouettes', (id) => {
    const p16 = portrait16(id);
    const p48 = portrait48(id);
    expect([p16.w, p16.h]).toEqual([16, 16]);
    expect([p48.w, p48.h]).toEqual([48, 48]);
    for (const m of [p16, p48]) {
      expect(validIndices(m)).toBe(true);
      const sil = lockedPortrait(m);
      for (const v of sil.data) expect([0, 1, 3]).toContain(v);
    }
  });

  it('icons have their declared sizes and valid indices', () => {
    for (const name of ICON_NAMES) {
      const m = buildIcon(name);
      expect([m.w, m.h], name).toEqual([...iconSize(name)]);
      expect(validIndices(m)).toBe(true);
    }
    expect(iconSize('headRival')).toEqual([6, 4]);
    expect(iconSize('offscreenArrow')).toEqual([8, 8]);
    for (const s of ['dim', 'bright', 'wrong'] as const) {
      expect(keyIcon('L', s).w).toBe(16);
      expect(keyIcon('R', s).h).toBe(16);
    }
  });

  it('effects are 16x16 with design frame counts', () => {
    const fx = buildEffects();
    const n = Object.fromEntries(fx.map((d) => [d.name, d.frames.length]));
    expect(n).toMatchObject({ dust: 4, spark: 4, exhaust: 4, warpRing: 6, gum: 4 });
    for (const d of fx) {
      for (const f of d.frames) {
        expect([f.w, f.h]).toEqual([16, 16]);
        expect(validIndices(f)).toBe(true);
      }
    }
    expect(fx.find((d) => d.name === 'dust')?.fps).toBe(16);
  });
});

describe('stadium (design 5.7, 5.8)', () => {
  it.each(TIERS.map((t) => [t]))('tier %i layers match the layer table', (tier) => {
    const check = (m: IndexMap, w: number, h: number) => {
      expect([m.w, m.h]).toEqual([w, h]);
      expect(validIndices(m)).toBe(true);
    };
    check(skyLayer(tier), LAYERS.sky.w, LAYERS.sky.h);
    check(farLayer(tier), LAYERS.far.w, LAYERS.far.h);
    check(standsLayer(tier, 0), LAYERS.stands.w, LAYERS.stands.h);
    check(standsLayer(tier, 1), LAYERS.stands.w, LAYERS.stands.h);
    check(nearLayer(tier), LAYERS.near.w, LAYERS.near.h);
    check(trackLayer(tier), LAYERS.track.w, LAYERS.track.h);
    check(fgLayer(tier), LAYERS.fg.w, LAYERS.fg.h);
  });

  it('keeps far-layer props out of the HUD band (screen rows 0-34, design 6.2)', () => {
    expect(LAYERS.far.y + FAR_SAFE_ROW).toBeGreaterThanOrEqual(35);
    for (const tier of TIERS) {
      const m = farLayer(tier);
      for (let y = 0; y < FAR_SAFE_ROW; y++)
        for (let x = 0; x < m.w; x++) expect(getPx(m, x, y), `tier ${tier} @${x},${y}`).toBe(0);
    }
  });

  it('track and infield texture stays calm (few grain pixels, one neighbouring tone)', () => {
    for (const tier of TIERS) {
      const tr = trackLayer(tier);
      const counts = new Map<number, number>();
      // Lane interiors only (between the lane lines; tier 7 deck seams at x 0 and row 30 excluded).
      for (const [y0, y1] of [
        [6, 26],
        [31, 50],
      ] as const)
        for (let y = y0; y < y1; y++)
          for (let x = 1; x < tr.w; x++) counts.set(getPx(tr, x, y), (counts.get(getPx(tr, x, y)) ?? 0) + 1);
      const sorted = [...counts.values()].sort((a, b) => b - a);
      const total = sorted.reduce((a, b) => a + b, 0);
      expect(counts.size, `tier ${tier} tones`).toBeLessThanOrEqual(tier === 7 ? 3 : 2);
      expect(1 - (sorted[0] as number) / total, `tier ${tier} grain`).toBeLessThan(0.06);
    }
  });

  it('sky is fully opaque and every tier looks different', () => {
    const skies = TIERS.map((t) => skyLayer(t));
    for (const s of skies) expect(s.data.includes(0)).toBe(false);
    expect(new Set(skies.map((s) => Array.from(s.data).join())).size).toBe(7);
  });

  it('crowd frames differ (bob)', () => {
    expect(Array.from(standsLayer(3, 0).data)).not.toEqual(Array.from(standsLayer(3, 1).data));
  });

  it('track has 1 px lane lines at y = 108, 132, 156 and tiles seamlessly', () => {
    const t = trackLayer(4);
    for (const y of [108, 132, 156]) for (let x = 0; x < 64; x++) expect(getPx(t, x, y - 104)).toBe(8);
    expect(getPx(trackLayer(7), 5, 4)).toBe(37);
  });

  it('foreground props stay below the runner feet and are at most 1 per 160 px', () => {
    expect(LAYERS.fg.y).toBeGreaterThan(152);
    expect(LAYERS.fg.w % 160).toBe(0);
  });

  it('markings and shadow sizes', () => {
    expect([groundShadow().w, groundShadow().h]).toEqual([20, 3]);
    for (const v of groundShadow().data) expect([0, 38]).toContain(v);
    expect(finishLine().h).toBe(49);
    expect(validIndices(distanceBoard(90))).toBe(true);
  });
});

describe('view math (design 5.7)', () => {
  it('mirrors the core world constants', () => {
    expect(VIEW.PX_PER_M).toBe(WORLD.PX_PER_M);
    expect(VIEW.START_X_PX).toBe(WORLD.START_X_PX);
    expect(VIEW.RACE_DISTANCE_M).toBe(WORLD.RACE_DISTANCE_M);
    expect(VIEW.RUN_OUT_M).toBe(WORLD.RUN_OUT_M);
  });

  it('keeps the player pivot at screen x 96 and clamps at both ends', () => {
    expect(worldX(0)).toBe(96);
    expect(FINISH_X_PX).toBe(2496);
    expect(cameraScroll(worldX(-2))).toBe(0);
    expect(cameraScroll(worldX(0))).toBe(0);
    expect(worldX(50) - cameraScroll(worldX(50))).toBe(96);
    expect(cameraScroll(worldX(500))).toBe(MAX_SCROLL);
    expect(Number.isInteger(cameraScroll(worldX(33.333)))).toBe(true);
  });
});

describe('runner animation selection (design 5.6)', () => {
  const rs = (p: Partial<RunnerState>): RunnerState => ({
    xM: 10,
    vMps: 10,
    anim: 'run',
    runFps: 20,
    effect: 'none',
    visible: true,
    finishMs: null,
    ...p,
  });

  it('maps ready anims to fixed frames and slow runs to the set pose', () => {
    const vs = { phase: 0, played: null };
    expect(pickRunnerView('rio', rs({ anim: 'ready1' }), 16, vs)).toEqual({ kind: 'frame', frame: 'ready0' });
    expect(pickRunnerView('rio', rs({ anim: 'ready2' }), 16, vs)).toEqual({ kind: 'frame', frame: 'ready1' });
    expect(pickRunnerView('rio', rs({ vMps: 0.2 }), 16, vs)).toEqual({ kind: 'frame', frame: 'ready1' });
  });

  it('advances the run cycle at runFps', () => {
    const vs = { phase: 0, played: null };
    const frames: string[] = [];
    for (let i = 0; i < 10; i++) {
      const p = pickRunnerView('rio', rs({ runFps: 10 }), 100, vs);
      if (p.kind === 'frame') frames.push(p.frame);
    }
    expect(frames).toEqual(['run1', 'run2', 'run3', 'run4', 'run5', 'run6', 'run7', 'run0', 'run1', 'run2']);
  });

  it('uses character variants for effects', () => {
    const vs = { phase: 0, played: null };
    expect(pickRunnerView('pip', rs({ effect: 'wave' }), 16, vs)).toEqual({ kind: 'anim', anim: 'wave' });
    const oc = pickRunnerView('unit7', rs({ effect: 'overclock' }), 0, vs);
    expect(oc.kind === 'frame' && oc.frame.startsWith('runOc')).toBe(true);
    const look = pickRunnerView('marco', rs({}), 0, vs, { coasting: true });
    expect(look.kind === 'frame' && look.frame.startsWith('runLook')).toBe(true);
    expect(pickRunnerView('jess', rs({ anim: 'celebrate' }), 0, vs)).toEqual({
      kind: 'anim',
      anim: 'celebrate',
    });
  });
});
