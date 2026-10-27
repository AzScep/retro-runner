/** v3 art (design 24.2, 26, 31, 33, 35): field bodies, Rio's trip, lanes, officials, UI art. */
import { describe, expect, it } from 'vitest';
import type { RunnerState } from '../core/index.ts';
import { getPx, validIndices, type IndexMap } from './bake/index.ts';
import { bakeArt, KEYS } from './baked.ts';
import {
  buildField,
  FIELD_BODIES,
  FIELD_TIER,
  FIELD_VARIANTS,
  fieldKitIndices,
  fieldSpec,
  type FieldBody,
} from './chars/field.ts';
import { buildCharacter } from './chars/index.ts';
import { FIELD_FRAME_COUNTS } from './chars/poses.ts';
import { portrait16Spec } from './sprites/portraits.ts';
import {
  BEAM_FRAMES,
  landingBeam,
  medal,
  MEDAL_PLACES,
  medalPip,
  meetBadge,
  MEET_TIERS,
  speechBubble,
  speechBubbleTail,
} from './sprites/meets.ts';
import {
  bellOfficial,
  JUDGE_COUNT,
  JUDGE_FRAMES,
  judge,
  photoCamera,
  pistolSmoke,
  starter,
  STARTER_FRAMES,
  starterHelmet,
} from './stadium/officials.ts';
import { FAR_SIDE_FEET_Y, LANE_COUNT, LANE_FEET_Y, LANE_LINE_Y, LANE_OBLIQUE_PX } from './stadium/layers.ts';
import { DEPTH } from './phaser/stadium.ts';
import { laneDepth, runnerScreenX } from './view/lanes.ts';
import { pickFieldView } from './view/runner.ts';

function bounds(m: IndexMap) {
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

const ARTS = FIELD_BODIES.flatMap((body) => FIELD_VARIANTS.map((v) => buildField(body, v)));
const frameOf = (body: FieldBody, v: string, name: string) =>
  ARTS.find((a) => a.body === body && a.variant === v)!.frames.find((f) => f.name === name)!.map;

describe('field bodies (design 24.2, 35.1)', () => {
  it('7 bodies x 4 variants, 31 frames each in the design anim split (868 frames)', () => {
    expect(ARTS).toHaveLength(28);
    let total = 0;
    for (const art of ARTS) {
      expect(art.frames).toHaveLength(31);
      total += art.frames.length;
      for (const a of art.anims) {
        expect(a.frames.length, `${art.body}.${art.variant}.${a.name}`).toBe(
          FIELD_FRAME_COUNTS[a.name as keyof typeof FIELD_FRAME_COUNTS],
        );
      }
      expect(art.anims.map((a) => a.name).sort()).toEqual(Object.keys(FIELD_FRAME_COUNTS).sort());
    }
    expect(total).toBe(868);
  });

  it('frames are 48x48, in palette, outlined, unclipped, grounded on row 46', () => {
    for (const art of ARTS) {
      for (const f of art.frames) {
        const id = `${art.body}.${art.variant}/${f.name}`;
        expect([f.map.w, f.map.h], id).toEqual([48, 48]);
        expect(validIndices(f.map), id).toBe(true);
        const b = bounds(f.map);
        expect(b.minX, id).toBeGreaterThanOrEqual(1);
        expect(b.minY, id).toBeGreaterThanOrEqual(1);
        expect(b.maxX, id).toBeLessThanOrEqual(46);
        expect(b.maxY, id).toBeLessThanOrEqual(47);
      }
      for (const n of ['walk0', 'walk1', 'ready0', 'ready1', 'lose0', 'lose1']) {
        const m = art.frames.find((f) => f.name === n)!.map;
        expect(bounds(m).maxY, `${art.body}.${art.variant}/${n}`).toBe(47);
      }
    }
  });

  it('waits behind the start line in the blocks, as the roster does (art.test)', () => {
    for (const art of ARTS) {
      for (const name of ['ready0', 'ready1']) {
        const m = art.frames.find((f) => f.name === name)!.map;
        expect(bounds(m).maxX - 12, `${art.body}.${art.variant} ${name}`).toBeLessThanOrEqual(23);
      }
    }
  });

  it('kit, skin and hair never use the player kit index 18, in the ramps or any pixel', () => {
    for (const art of ARTS) {
      expect(fieldKitIndices(art.body, art.variant).has(18), `${art.body}.${art.variant}`).toBe(false);
      for (const f of art.frames)
        expect(f.map.data.includes(18), `${art.body}.${art.variant}/${f.name}`).toBe(false);
    }
  });

  it('bodies have their cohort heights relative to Rio (~40): kid ~30, teen ~37, drone ~44 px', () => {
    const h = (m: IndexMap) => bounds(m).maxY - bounds(m).minY - 1;
    const rio = h(buildCharacter('rio').frames.find((f) => f.name === 'walk1')!.map);
    // Design heights minus Rio's design 40, +/- 2 px.
    const want: Record<FieldBody, number> = {
      fKid: -10,
      fTeen: -3,
      fStudent: 0,
      fClub: 0,
      fElite: 1,
      fBot: 0,
      fDrone: 4,
    };
    for (const body of FIELD_BODIES) {
      for (const v of FIELD_VARIANTS) {
        const d = h(frameOf(body, v, 'walk1')) - rio;
        expect(Math.abs(d - want[body]), `${body}.${v}: ${d}`).toBeLessThanOrEqual(2);
      }
    }
  });

  it('the 4 variants of a human cohort look different; drones differ only by the bib digit', () => {
    const diff = (a: IndexMap, b: IndexMap) => a.data.reduce((n, v, i) => n + (v !== b.data[i] ? 1 : 0), 0);
    for (const body of FIELD_BODIES) {
      const runs = FIELD_VARIANTS.map((v) => frameOf(body, v, 'run2'));
      for (let i = 0; i < 4; i++)
        for (let j = i + 1; j < 4; j++) {
          const d = diff(runs[i]!, runs[j]!);
          if (body === 'fDrone') {
            expect(d, `${body} ${i}/${j}`).toBeGreaterThan(0);
            expect(d, `${body} ${i}/${j}`).toBeLessThanOrEqual(15);
          } else if (body === 'fBot') {
            // Robots: visor colour, model number and (between pairs) chrome or grey chassis.
            expect(d, `${body} ${i}/${j}`).toBeGreaterThan(8);
          } else {
            expect(d, `${body} ${i}/${j}`).toBeGreaterThan(40);
          }
        }
    }
  });

  it('every field variant has a 16x16 portrait in palette without index 18', () => {
    for (const body of FIELD_BODIES) {
      for (const v of FIELD_VARIANTS) {
        const p = portrait16Spec(fieldSpec(body, v));
        expect([p.w, p.h]).toEqual([16, 16]);
        expect(validIndices(p)).toBe(true);
        expect(p.data.includes(18)).toBe(false);
      }
    }
    expect(Object.values(FIELD_TIER).sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('bakes every variant with its 8 anims on the field page', () => {
    const art = bakeArt();
    const anims = new Set(art.anims.map((a) => a.key));
    for (const body of FIELD_BODIES)
      for (const v of FIELD_VARIANTS)
        for (const name of Object.keys(FIELD_FRAME_COUNTS))
          expect(anims.has(KEYS.fieldAnim(body, v, name))).toBe(true);
  });
});

describe("Rio's trip (design 33.2, 35.1)", () => {
  const rio = buildCharacter('rio');
  it('has fall 3, lie 1 and getup 3 at 12 fps, played once', () => {
    for (const [name, n] of [
      ['fall', 3],
      ['lie', 1],
      ['getup', 3],
    ] as const) {
      const a = rio.anims.find((x) => x.name === name)!;
      expect(a.frames, name).toHaveLength(n);
      expect([a.fps, a.repeat]).toEqual([12, 0]);
    }
  });

  it('falls lower frame by frame and lies flat on the ground row', () => {
    const height = (n: string) => {
      const b = bounds(rio.frames.find((f) => f.name === n)!.map);
      return b.maxY - b.minY;
    };
    expect(height('fall0')).toBeGreaterThan(height('fall1'));
    expect(height('fall1')).toBeGreaterThan(height('fall2'));
    expect(height('lie0')).toBeLessThanOrEqual(16);
    expect(bounds(rio.frames.find((f) => f.name === 'lie0')!.map).maxY).toBe(47);
    expect(height('getup2')).toBeGreaterThan(height('getup0'));
  });
});

describe('lanes (design 26.1-26.3)', () => {
  it('uses the layout R rows and the +10 px oblique', () => {
    expect(LANE_FEET_Y).toEqual([157, 143, 132, 123, 115, 108]);
    expect(LANE_LINE_Y).toEqual([161, 147, 136, 127, 119, 112, 105]);
    expect(LANE_OBLIQUE_PX).toBe(10);
    expect(LANE_COUNT).toBe(6);
    // Each lane line sits 4 px under its feet row.
    LANE_FEET_Y.forEach((y, k) => expect(LANE_LINE_Y[k]).toBe(y + 4));
    expect(FAR_SIDE_FEET_Y).toBe(100);
  });

  it('draws far lanes first: hurdles < shadow < runner < fx, every lane below the nearer one', () => {
    for (let k = 0; k < LANE_COUNT; k++) {
      const d = laneDepth(k);
      expect(d.hurdle).toBeLessThan(d.shadow);
      expect(d.shadow).toBeLessThan(d.runner);
      expect(d.runner).toBeLessThan(d.fx);
      if (k < LANE_COUNT - 1) expect(laneDepth(k + 1).fx).toBeLessThan(d.hurdle);
      expect(d.hurdle).toBeGreaterThan(DEPTH.officialsFx);
    }
    expect(laneDepth(0).runner).toBe(DEPTH.player);
    expect(laneDepth(1).runner).toBe(DEPTH.rival);
    expect(laneDepth(0).fx).toBeLessThan(DEPTH.dust);
    expect(DEPTH.dust).toBeLessThan(DEPTH.fg);
  });

  it('shifts each runner by its lane oblique; the blocks shift still applies at the start', () => {
    expect(runnerScreenX(0, 10, 0) - runnerScreenX(5, 10, 0)).toBe(-50);
    expect(runnerScreenX(3, 50, 1000)).toBe(96 + 50 * 24 + 30 - 1000);
    expect(runnerScreenX(2, 0, 0)).toBe(96 - 12 + 20);
  });

  it('picks field frames from the runner state', () => {
    const s = (anim: RunnerState['anim'], extra: Partial<RunnerState> = {}): RunnerState => ({
      xM: 10,
      vMps: 9,
      anim,
      runFps: 18,
      effect: 'none',
      visible: true,
      finishMs: null,
      airM: 0,
      airPhase: null,
      hurdlesKnocked: [],
      stamina: null,
      ...extra,
    });
    const vs = { phase: 0, played: null };
    expect(pickFieldView(s('ready1'), 16, vs)).toEqual({ kind: 'frame', frame: 'ready0' });
    expect(pickFieldView(s('ready2'), 16, vs)).toEqual({ kind: 'frame', frame: 'ready1' });
    expect(pickFieldView(s('run', { vMps: 0.1 }), 16, vs)).toEqual({ kind: 'frame', frame: 'ready1' });
    expect(pickFieldView(s('run'), 500, vs)).toEqual({ kind: 'frame', frame: 'run1' });
    expect(pickFieldView(s('hurdle', { airPhase: 0.6 }), 16, vs)).toEqual({
      kind: 'frame',
      frame: 'hurdle2',
    });
    expect(pickFieldView(s('celebrate'), 16, vs)).toEqual({ kind: 'anim', anim: 'celebrate' });
    expect(pickFieldView(s('idle'), 16, vs)).toEqual({ kind: 'frame', frame: 'walk1' });
  });
});

describe('officials (design 31.2, 31.3, 35.2)', () => {
  it('have the design sizes and frames, in palette', () => {
    const all: IndexMap[] = [
      ...STARTER_FRAMES.map((f) => starter(f)),
      starterHelmet(),
      bellOfficial(0),
      bellOfficial(1),
    ];
    for (const m of all) {
      expect([m.w, m.h]).toEqual([32, 32]);
      expect(validIndices(m)).toBe(true);
    }
    expect(STARTER_FRAMES).toEqual(['idle0', 'idle1', 'armUp', 'fire', 'point']);
    const smoke = pistolSmoke();
    expect(smoke).toHaveLength(3);
    for (const m of smoke) expect([m.w, m.h]).toEqual([16, 16]);
    expect(JUDGE_COUNT).toBe(3);
    for (let v = 0; v < JUDGE_COUNT; v++)
      for (const f of JUDGE_FRAMES) expect([judge(v, f).w, judge(v, f).h]).toEqual([16, 16]);
    expect(JUDGE_FRAMES).toEqual(['sit0', 'sit1', 'lean', 'stand']);
  });

  it('stand on the far-side row: feet on row 30 of 32, the head never moves (helmet fits)', () => {
    for (const f of STARTER_FRAMES) {
      const m = starter(f);
      expect(bounds(m).maxY, f).toBe(31);
      // Head pixels at the head centre column stay put across frames.
      expect(getPx(m, 17, 9), f).toBe(getPx(starter('idle0'), 17, 9));
    }
  });

  it('photo-finish camera is 8x40 with a 2x2 light in index 18 only when on, never a flash', () => {
    const off = photoCamera(false);
    const on = photoCamera(true);
    expect([off.w, off.h]).toEqual([8, 40]);
    expect(off.data.includes(18)).toBe(false);
    expect(on.data.filter((v) => v === 18 || v === 19).length).toBe(4);
    // Only the light differs.
    expect(off.data.reduce((n, v, i) => n + (v !== on.data[i] ? 1 : 0), 0)).toBe(4);
  });
});

describe('v3 UI art (design 31.1, 35.3, 30.2)', () => {
  it('7 distinct 16x16 meet badges', () => {
    const maps = MEET_TIERS.map((t) => meetBadge(t));
    for (const m of maps) {
      expect([m.w, m.h]).toEqual([16, 16]);
      expect(validIndices(m)).toBe(true);
    }
    expect(new Set(maps.map((m) => Array.from(m.data).join())).size).toBe(7);
  });

  it('medal pips are 6x6 and medals 8x8, gold, silver and bronze all different', () => {
    for (const p of MEDAL_PLACES) {
      expect([medalPip(p).w, medalPip(p).h]).toEqual([6, 6]);
      expect([medal(p).w, medal(p).h]).toEqual([8, 8]);
    }
    expect(new Set(MEDAL_PLACES.map((p) => Array.from(medalPip(p).data).join())).size).toBe(3);
    expect(new Set(MEDAL_PLACES.map((p) => Array.from(medal(p).data).join())).size).toBe(3);
  });

  it('speech bubble: 12x12 9-slice in index 8 fill and index 1 outline, 3x3 tail', () => {
    const b = speechBubble();
    expect([b.w, b.h]).toEqual([12, 12]);
    expect(new Set(Array.from(b.data))).toEqual(new Set([0, 1, 8]));
    // Edges are uniform along their length so the 4 px pieces stretch cleanly.
    for (let x = 4; x < 8; x++) expect([getPx(b, x, 0), getPx(b, x, 1), getPx(b, x, 11)]).toEqual([1, 8, 1]);
    const t = speechBubbleTail();
    expect([t.w, t.h]).toEqual([3, 3]);
    expect(getPx(t, 1, 0)).toBe(8);
  });

  it('landing beam: 16x48, 4 different shimmer frames and a static frame', () => {
    const frames = Array.from({ length: BEAM_FRAMES }, (_, i) => landingBeam(i));
    for (const m of [...frames, landingBeam('static')]) expect([m.w, m.h]).toEqual([16, 48]);
    expect(new Set(frames.map((m) => Array.from(m.data).join())).size).toBe(4);
  });
});
