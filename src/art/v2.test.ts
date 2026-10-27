/// <reference types="node" />
/** v2 art (design 19): Sol, hurdle and tired anims, hurdle props, UI icons, touch art, icons. */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { TUNING, type RunnerState } from '../core/index.ts';
import { getPx, validIndices, type IndexMap } from './bake/index.ts';
import { buildCharacter, CHARACTER_IDS, HURDLE_FRAMES, HURDLERS } from './chars/index.ts';
import { ANIM_FRAME_COUNTS, WATCH_FPS, WATCH_OVERLAY_POSES } from './chars/poses.ts';
import { rotatePhoneUrl, touchArtUrl } from './touchUrl.ts';
import { encodeIndexedPng } from './png.ts';
import { APP_ICON_BG, APP_ICONS, appIcon } from './sprites/appIcon.ts';
import { buildEffects } from './sprites/effects.ts';
import { eventPictogram, PICTOGRAM_EVENTS } from './sprites/events.ts';
import { buildIcon, ICON_NAMES, iconSize, keyIcon, lapOvalPoint } from './sprites/icons.ts';
import { lockedPortrait, portrait16, portrait48 } from './sprites/portraits.ts';
import {
  TOUCH_ART_DESIGN_STATES,
  TOUCH_ART_IDS,
  TOUCH_ART_SIZE,
  TOUCH_ART_STATES,
  touchArt,
} from './sprites/touch.ts';
import {
  AIR_SHADOW_SIZES,
  airShadow,
  airShadowIndex,
  bellOfficial,
  board50,
  FAR_LANE_HURDLE_OFFSET_PX,
  HURDLE_BAR_TOP_ROW,
  HURDLE_FRAME,
  hurdleKnockFrames,
  hurdleStanding,
  splitBoard,
} from './stadium/props.ts';
import { farLayer, LANE_FEET_Y, nearLayer } from './stadium/layers.ts';
import { airRaisePx, hurdleFrameIndex, pickRunnerView } from './view/runner.ts';

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

const ART = Object.fromEntries(CHARACTER_IDS.map((id) => [id, buildCharacter(id)]));
const anim = (id: string, name: string) => ART[id]?.anims.find((a) => a.name === name);
const frame = (id: string, name: string) => ART[id]?.frames.find((f) => f.name === name)?.map as IndexMap;
const uses = (m: IndexMap, v: number) => m.data.includes(v);

describe('Sol (design 15.5, 19.1)', () => {
  it('has the full 35-frame set and a 2-pose watch glance overlaid on the run cycle', () => {
    let n = 0;
    for (const [name, count] of Object.entries(ANIM_FRAME_COUNTS)) {
      expect(anim('sol', name)?.frames, name).toHaveLength(count);
      n += count;
    }
    expect(n).toBe(35);
    expect(WATCH_OVERLAY_POSES).toBe(2);
    expect(WATCH_FPS).toBe(6);
    // Upper-body overlay only: every watch frame keeps the legs (bottom 16 rows) of its run frame.
    for (let k = 0; k < 2; k++) {
      for (let i = 0; i < 8; i++) {
        const w = frame('sol', `watch${k}_${i}`);
        const r = frame('sol', `run${i}`);
        expect(w, `watch${k}_${i}`).toBeDefined();
        expect(Array.from(w.data.subarray(32 * 48)), `legs ${k}_${i}`).toEqual(
          Array.from(r.data.subarray(32 * 48)),
        );
        expect(Array.from(w.data)).not.toEqual(Array.from(r.data));
      }
    }
  });

  it('is tall and lean (~42 px, taller than the adults) in the orange/white kit with a watch', () => {
    const h = (id: string) => {
      const b = bounds(frame(id, 'idle0'));
      return b.maxY - b.minY - 1;
    };
    expect(h('sol')).toBeGreaterThanOrEqual(41);
    expect(h('sol')).toBeLessThanOrEqual(43);
    expect(h('sol')).toBeGreaterThan(h('rio'));
    const idle = frame('sol', 'idle0');
    for (const v of [8, 21, 7, 14, 5]) expect(uses(idle, v), `index ${v}`).toBe(true);
    // The yellow sun emblem shows on the chest whenever the near arm swings clear of it.
    const runs = [0, 1, 2, 3, 4, 5, 6, 7].filter((i) => uses(frame('sol', `run${i}`), 22));
    expect(runs.length).toBeGreaterThanOrEqual(4);
    // Skin stays on the 9-11 ramp.
    for (const v of [12, 13]) expect(uses(idle, v), `skin ${v}`).toBe(false);
  });

  it('nods instead of jumping on celebrate (feet stay on the ground)', () => {
    for (const f of anim('sol', 'celebrate')?.frames ?? []) expect(bounds(frame('sol', f)).maxY).toBe(47);
  });

  it('has 16 and 48 px portraits with silhouettes', () => {
    expect([portrait16('sol').w, portrait48('sol').w]).toEqual([16, 48]);
    for (const v of lockedPortrait(portrait48('sol')).data) expect([0, 1, 3]).toContain(v);
  });
});

describe('hurdle and tired anims (design 19.1)', () => {
  it('gives the 8 hurdlers a 4-frame hurdle anim, and only them', () => {
    expect(HURDLERS).toHaveLength(8);
    expect(HURDLERS).not.toContain('sol');
    for (const id of HURDLERS) expect(anim(id, 'hurdle')?.frames, id).toHaveLength(HURDLE_FRAMES);
    expect(anim('sol', 'hurdle')).toBeUndefined();
  });

  it('frames are 48x48, outlined, distinct, with the lowest pixel on the ground row', () => {
    for (const id of HURDLERS) {
      const keys = new Set<string>();
      for (let i = 0; i < 4; i++) {
        const m = frame(id, `hurdle${i}`);
        expect([m.w, m.h]).toEqual([48, 48]);
        expect(validIndices(m)).toBe(true);
        const b = bounds(m);
        expect(b.maxY, `${id} hurdle${i}`).toBe(47);
        expect(b.minY).toBeGreaterThanOrEqual(1);
        expect(b.minX).toBeGreaterThanOrEqual(1);
        expect(b.maxX).toBeLessThanOrEqual(46);
        keys.add(Array.from(m.data).join());
      }
      expect(keys.size, id).toBe(4);
    }
  });

  it('peak frame clears the bar by a third of a sprite when raised 31 px (design 13.2, 22)', () => {
    // Raised round(1.30 * 24) = 31 px, the lowest body pixel (row 46) sits 31 px above the feet row,
    // the bar top 24 px: 7 px of daylight.
    expect(airRaisePx(1.3)).toBe(31);
    expect(airRaisePx(1.3) - 24).toBeGreaterThanOrEqual(6);
    expect(airRaisePx(0)).toBe(0);
  });

  it("Rio's tired run is 8 frames, differs from the run, and the frame counts total 77", () => {
    expect(anim('rio', 'tired')?.frames).toHaveLength(8);
    for (let i = 0; i < 8; i++) {
      expect(Array.from(frame('rio', `tired${i}`).data)).not.toEqual(
        Array.from(frame('rio', `run${i}`).data),
      );
    }
    // Design 19.1 counts the watch glance as its 2 overlay poses.
    const newFrames = HURDLERS.length * 4 + 8 + 35 + WATCH_OVERLAY_POSES;
    expect(newFrames).toBe(77);
  });

  const rs = (p: Partial<RunnerState>): RunnerState => ({
    xM: 20,
    vMps: 10,
    anim: 'run',
    runFps: 20,
    effect: 'none',
    visible: true,
    finishMs: null,
    airM: 0,
    airPhase: null,
    hurdlesKnocked: [],
    stamina: null,
    ...p,
  });

  it('picks the hurdle frame from the arc phase, tired and watch variants', () => {
    expect([0, 0.24, 0.25, 0.5, 0.74, 0.99, 1].map(hurdleFrameIndex)).toEqual([0, 0, 1, 2, 2, 3, 3]);
    const vs = { phase: 0, played: null };
    expect(pickRunnerView('kofi', rs({ anim: 'hurdle', airPhase: 0.55, airM: 1.2 }), 16, vs)).toEqual({
      kind: 'frame',
      frame: 'hurdle2',
    });
    const t = pickRunnerView('rio', rs({ anim: 'tired' }), 0, vs);
    expect(t.kind === 'frame' && t.frame.startsWith('tired')).toBe(true);
    const tp = pickRunnerView('pip', rs({ anim: 'tired' }), 0, vs);
    expect(tp.kind === 'frame' && tp.frame.startsWith('run')).toBe(true);
    // Watch glance: legs follow the run phase, upper body switches pose at 6 fps.
    const ws = { phase: 0, played: null };
    const w0 = pickRunnerView('sol', rs({ effect: 'watch', runFps: 10 }), 100, ws);
    expect(w0).toEqual({ kind: 'frame', frame: 'watch0_1' });
    const w1 = pickRunnerView('sol', rs({ effect: 'watch', runFps: 10 }), 100, ws);
    expect(w1).toEqual({ kind: 'frame', frame: 'watch1_2' });
    expect(pickRunnerView('sol', rs({ runFps: 10 }), 100, ws)).toEqual({ kind: 'frame', frame: 'run3' });
  });
});

describe('props (design 13.1, 19.2)', () => {
  it('standing hurdle: 16x28 footprint, bar top exactly 24 px above the feet row, striped 8/1', () => {
    const m = hurdleStanding();
    expect([m.w, m.h]).toEqual([HURDLE_FRAME.w, HURDLE_FRAME.h]);
    const b = bounds(m);
    expect(b.maxX - b.minX + 1).toBeLessThanOrEqual(16);
    expect(b.minX).toBeGreaterThanOrEqual(0);
    expect(b.maxY).toBe(HURDLE_FRAME.pivotY); // outline under the ground row
    expect(HURDLE_FRAME.groundRow - b.minY).toBe(24);
    expect(b.minY).toBe(HURDLE_BAR_TOP_ROW);
    expect(Math.abs(HURDLE_FRAME.pivotX - (b.minX + b.maxX + 1) / 2)).toBeLessThanOrEqual(1);
    // Bar row: white and black stripes.
    const row = Array.from({ length: 16 }, (_, x) => getPx(m, x, b.minY + 1));
    expect(row).toContain(8);
    expect(row).toContain(1);
    // Ground contact on the feet row.
    expect(
      Array.from({ length: m.w }, (_, x) => getPx(m, x, HURDLE_FRAME.groundRow)).some((v) => v > 1),
    ).toBe(true);
  });

  it('has 4 knock frames that fall forward and end lying on the ground', () => {
    const k = hurdleKnockFrames();
    expect(k).toHaveLength(4);
    let lastTop = HURDLE_BAR_TOP_ROW;
    for (const m of k) {
      expect(validIndices(m)).toBe(true);
      const b = bounds(m);
      expect(b.minY).toBeGreaterThan(lastTop - 1);
      expect(b.maxY).toBeLessThanOrEqual(HURDLE_FRAME.pivotY);
      expect(b.minX).toBeGreaterThanOrEqual(0);
      expect(b.maxX).toBeLessThan(HURDLE_FRAME.w);
      lastTop = b.minY;
    }
    const lying = bounds(k[3] as IndexMap);
    expect(HURDLE_FRAME.pivotY - lying.minY).toBeLessThanOrEqual(8);
  });

  it('boards, official, clip burst and air shadows have the design sizes', () => {
    expect([board50(150).w, board50(150).h]).toEqual([16, 12]);
    expect([splitBoard(300).w, splitBoard(300).h]).toEqual([24, 16]);
    const b0 = bellOfficial(0);
    const b1 = bellOfficial(1);
    expect([b0.w, b0.h, b1.w, b1.h]).toEqual([32, 32, 32, 32]);
    expect(Array.from(b0.data)).not.toEqual(Array.from(b1.data));
    const clip = buildEffects().find((d) => d.name === 'clip');
    expect(clip?.frames).toHaveLength(4);
    expect(clip?.fps).toBe(16);
    expect(AIR_SHADOW_SIZES[0]).toEqual([20, 3]);
    expect(AIR_SHADOW_SIZES[3]).toEqual([14, 2]);
    for (let i = 0; i < 4; i++) {
      const s = airShadow(i);
      expect([s.w, s.h]).toEqual([...(AIR_SHADOW_SIZES[i] as readonly [number, number])]);
      for (const v of s.data) expect([0, 38]).toContain(v);
    }
    expect(airShadowIndex(0)).toBe(0);
    expect(airShadowIndex(31)).toBe(3);
    expect(airShadowIndex(5)).toBe(1);
  });

  it('draws far-lane hurdles 16 px right so they never touch the near-lane hurdle (perspective)', () => {
    expect(FAR_LANE_HURDLE_OFFSET_PX).toBe(16);
    const m = hurdleStanding();
    const px = (feetY: number, dx: number) => {
      const out = new Set<string>();
      for (let y = 0; y < m.h; y++)
        for (let x = 0; x < m.w; x++)
          if (getPx(m, x, y))
            out.add(`${x - HURDLE_FRAME.pivotX + dx},${y - HURDLE_FRAME.pivotY + feetY + 1}`);
      return out;
    };
    const near = px(LANE_FEET_Y.player, 0);
    const far = px(LANE_FEET_Y.rival, FAR_LANE_HURDLE_OFFSET_PX);
    // No shared pixel and no 4-neighbour contact: two separate gates.
    for (const k of far) {
      const [x, y] = k.split(',').map(Number) as [number, number];
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const)
        expect(near.has(`${x + dx},${y + dy}`), k).toBe(false);
    }
    // Without the offset they would overlap (the stacked "ladder").
    const stacked = px(LANE_FEET_Y.rival, 0);
    expect([...stacked].some((k) => near.has(k))).toBe(true);
  });

  it('signage names the event: 400M, HURDLES / 110M, default 100M', () => {
    const differs = (a: IndexMap, b: IndexMap) => Array.from(a.data).join() !== Array.from(b.data).join();
    for (const tier of [1, 4, 7]) {
      expect(Array.from(nearLayer(tier).data)).toEqual(Array.from(nearLayer(tier, '100m').data));
      expect(differs(nearLayer(tier, '400m'), nearLayer(tier))).toBe(true);
      expect(differs(nearLayer(tier, '110mh'), nearLayer(tier, '400m'))).toBe(true);
    }
    expect(differs(farLayer(4, '400m'), farLayer(4))).toBe(true);
  });

  it('uses the core fatigue threshold for sweat', () => {
    expect(TUNING.S_FATIGUE).toBe(0.3);
  });
});

describe('UI art (design 18, 19.3)', () => {
  it('every icon has its declared size and valid indices', () => {
    for (const name of ICON_NAMES) {
      const m = buildIcon(name);
      expect([m.w, m.h], name).toEqual([...iconSize(name)]);
      expect(validIndices(m), name).toBe(true);
    }
    expect(iconSize('crown')).toEqual([8, 8]);
    expect(iconSize('newBadge')).toEqual([24, 8]);
    expect(iconSize('rotatePhone')).toEqual([32, 32]);
    expect(iconSize('staminaArrowUp')).toEqual([5, 3]);
    expect(iconSize('lapOval')).toEqual([32, 16]);
    expect(iconSize('hurdleTick')).toEqual([2, 3]);
    for (const v of buildIcon('hurdleTick').data) expect(v).toBe(8);
    for (const v of buildIcon('hurdleTickHit').data) expect(v).toBe(17);
  });

  it('up key has dim, bright and wrong states', () => {
    const keys = (['dim', 'bright', 'wrong'] as const).map((s) => keyIcon('U', s));
    for (const k of keys) expect([k.w, k.h]).toEqual([16, 16]);
    expect(new Set(keys.map((k) => Array.from(k.data).join())).size).toBe(3);
    expect(Array.from(keyIcon('U', 'bright').data)).not.toEqual(Array.from(keyIcon('R', 'bright').data));
  });

  it('lap oval: index 6 track, dots go round counter-clockwise and finish bottom-right', () => {
    const m = buildIcon('lapOval');
    expect(new Set(Array.from(m.data).filter((v) => v))).toEqual(new Set([6, 8]));
    const [x0, y0] = lapOvalPoint(0);
    const [x1, y1] = lapOvalPoint(100);
    const [x3, y3] = lapOvalPoint(300);
    expect(y0).toBeGreaterThan(12); // start/finish on the bottom (home straight end)
    expect(x0).toBeGreaterThan(20);
    expect(y1).toBeLessThan(3); // after the first bend: top
    expect(x3).toBeLessThan(10);
    expect(y3).toBeGreaterThan(12);
    expect(lapOvalPoint(400)).toEqual(lapOvalPoint(0));
    expect(x1).toBeGreaterThan(20);
  });

  it('event pictograms: 3 events at 32 and 16 px, locked variants are dark silhouettes', () => {
    for (const e of PICTOGRAM_EVENTS) {
      for (const size of [16, 32] as const) {
        const m = eventPictogram(e, size);
        expect([m.w, m.h]).toEqual([size, size]);
        expect(validIndices(m)).toBe(true);
        expect(uses(m, 8), `${e} ${size} figure`).toBe(true);
        const l = eventPictogram(e, size, true);
        for (const v of l.data) expect([0, 1, 2, 3]).toContain(v);
      }
    }
  });
});

describe('touch art (design 17.4)', () => {
  it('draws every control in every state at its size, in palette, hollow', () => {
    for (const id of TOUCH_ART_IDS) {
      for (const st of TOUCH_ART_STATES) {
        const m = touchArt(id, st);
        expect([m.w, m.h], `${id} ${st}`).toEqual([...TOUCH_ART_SIZE[id]]);
        expect(validIndices(m)).toBe(true);
        if (id.startsWith('pad')) {
          const opaque = m.data.filter((v) => v !== 0).length;
          expect(opaque / m.data.length, `${id} ${st} hollow`).toBeLessThan(0.55);
          expect(getPx(m, 6, Math.floor(m.h / 2)), `${id} interior`).toBe(0);
        }
      }
    }
  });

  it('distinguishes the 17.4 states and uses the specified indices', () => {
    for (const id of TOUCH_ART_IDS) {
      const states = TOUCH_ART_DESIGN_STATES[id];
      const keys = new Set(states.map((s) => Array.from(touchArt(id, s).data).join()));
      expect(keys.size, id).toBe(states.length);
    }
    const border = (m: IndexMap) => getPx(m, 32, 1);
    expect(border(touchArt('padL', 'idle'))).toBe(6);
    expect(border(touchArt('padL', 'expected'))).toBe(22);
    expect(border(touchArt('padR', 'pressed'))).toBe(22);
    expect(border(touchArt('padR', 'blocked'))).toBe(5);
    expect(border(touchArt('padJump', 'ready'))).toBe(22);
    expect(uses(touchArt('padL', 'fumble'), 17)).toBe(true);
    expect(uses(touchArt('padL', 'expected'), 8)).toBe(true);
    // Pressed: inner index 22 ring inside the border.
    expect(getPx(touchArt('padL', 'pressed'), 32, 4)).toBe(22);
    expect(getPx(touchArt('padL', 'idle'), 32, 4)).toBe(0);
    // Outer and inner 1 px ink outlines.
    expect(getPx(touchArt('padL', 'idle'), 32, 0)).toBe(1);
    expect(getPx(touchArt('padL', 'idle'), 32, 3)).toBe(1);
  });

  const decode = (url: string) => {
    expect(url.startsWith('data:image/png;base64,')).toBe(true);
    const buf = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');
    return readPng(buf);
  };

  it('returns integer-scaled PNG data URLs that decode to the right pixels', () => {
    for (const id of TOUCH_ART_IDS) {
      for (const st of TOUCH_ART_STATES) {
        const png = decode(touchArtUrl(id, st, 3));
        const [w, h] = TOUCH_ART_SIZE[id];
        expect([png.w, png.h]).toEqual([w * 3, h * 3]);
      }
    }
    const src = touchArt('padR', 'pressed');
    const png = decode(touchArtUrl('padR', 'pressed', 2));
    for (let y = 0; y < png.h; y++)
      for (let x = 0; x < png.w; x++)
        expect(png.px[y * png.w + x]).toBe(src.data[Math.floor(y / 2) * src.w + Math.floor(x / 2)]);
    expect(touchArtUrl('padR', 'pressed', 2)).toBe(touchArtUrl('padR', 'pressed', 2));
    for (const f of [0, 1, 2, 3] as const) expect(decode(rotatePhoneUrl(f, 1)).w).toBe(32);
  });
});

/** Minimal indexed-PNG reader for the tests (colour type 3, filter 0, as our encoder writes). */
function readPng(buf: Buffer): { w: number; h: number; px: Uint8Array; transparent0: boolean } {
  expect(Array.from(buf.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  let o = 8;
  let w = 0;
  let h = 0;
  let transparent0 = false;
  const idat: Buffer[] = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('ascii', o + 4, o + 8);
    const data = buf.subarray(o + 8, o + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      expect([data[8], data[9]]).toEqual([8, 3]);
    }
    if (type === 'tRNS') transparent0 = data[0] === 0;
    if (type === 'IDAT') idat.push(Buffer.from(data));
    o += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  expect(raw.length).toBe((w + 1) * h);
  const px = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    expect(raw[y * (w + 1)]).toBe(0);
    px.set(raw.subarray(y * (w + 1) + 1, (y + 1) * (w + 1)), y * w);
  }
  return { w, h, px, transparent0 };
}

describe('PNG encoder and Home Screen icons (design 19.3)', () => {
  it('round-trips through zlib, with index 0 transparent', () => {
    const m = hurdleStanding();
    const png = readPng(Buffer.from(encodeIndexedPng(m, { scale: 4 })));
    expect([png.w, png.h]).toEqual([m.w * 4, m.h * 4]);
    expect(png.transparent0).toBe(true);
    expect(png.px[(4 * HURDLE_BAR_TOP_ROW + 1) * png.w + 4 * 8]).toBe(1);
  });

  it('app icon is a 32x32 opaque map of Rio on index 1', () => {
    const m = appIcon();
    expect([m.w, m.h]).toEqual([32, 32]);
    expect(m.data.includes(0)).toBe(false);
    expect(m.data[0]).toBe(APP_ICON_BG);
    for (const v of [22, 14, 12]) expect(uses(m, v), `index ${v}`).toBe(true);
  });

  it('public/icons holds the integer-upscaled PNGs at 180, 192, 512 and 512 maskable', () => {
    const dir = join(process.cwd(), 'public', 'icons');
    expect(APP_ICONS.map((s) => s.size)).toEqual([180, 192, 512, 512]);
    for (const spec of APP_ICONS) {
      const p = join(dir, spec.file);
      expect(existsSync(p), `${spec.file} missing: run node scripts/icons.ts`).toBe(true);
      const buf = readFileSync(p);
      expect(
        Buffer.compare(
          buf,
          Buffer.from(
            encodeIndexedPng(appIcon(), {
              scale: spec.scale,
              background: APP_ICON_BG,
              canvas: spec.size,
            }),
          ),
        ),
        `${spec.file} is stale: run node scripts/icons.ts`,
      ).toBe(0);
      const png = readPng(buf);
      expect([png.w, png.h]).toEqual([spec.size, spec.size]);
      expect(png.transparent0).toBe(false);
      expect(Number.isInteger(spec.scale)).toBe(true);
    }
    // Maskable: art inside the 80 % safe circle (corners of the scaled art within radius 0.4 * 512 + margin).
    const mask = APP_ICONS.find((s) => s.file.includes('maskable'));
    expect(mask && (mask.scale * 32) / 2).toBeLessThanOrEqual(0.4 * 512 * Math.SQRT2);
    expect(mask && mask.scale * 32).toBeLessThanOrEqual(0.8 * 512);
  });
});
