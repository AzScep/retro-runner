/**
 * Contact sheets for visual review: `node tools/art/sheet.ts` writes PNGs at 4x to tools/art/out/.
 * Imports only pure art modules (no Phaser).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from './png.ts';
import { PALETTE } from '../../src/art/palette.ts';
import type { IndexMap } from '../../src/art/bake/index.ts';
import { ANIMS, animPoses } from '../../src/art/chars/poses.ts';
import { renderPose } from '../../src/art/chars/rig.ts';
import { SPECS } from '../../src/art/chars/specs.ts';

const OUT = join(dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(OUT, { recursive: true });

const SCALE = Number(process.env.SCALE ?? 4);

interface Cell {
  readonly map: IndexMap;
  readonly bg?: number;
}

/** Lay out rows of cells with a 2 px gap, nearest-neighbour scaled. */
function sheet(
  rows: readonly (readonly Cell[])[],
  defaultBg: number,
  gap = 2,
): { rgba: Uint8Array; w: number; h: number } {
  const colW = rows.reduce(
    (m, r) =>
      Math.max(
        m,
        r.reduce((s, c) => s + c.map.w + gap, gap),
      ),
    0,
  );
  const rowH = rows.map((r) => r.reduce((m, c) => Math.max(m, c.map.h), 0) + gap);
  const W = colW;
  const H = rowH.reduce((s, h) => s + h, gap);
  const px = new Uint8Array(W * H * 4);
  const put = (x: number, y: number, rgb: number) => {
    const i = (y * W + x) * 4;
    px[i] = (rgb >> 16) & 255;
    px[i + 1] = (rgb >> 8) & 255;
    px[i + 2] = rgb & 255;
    px[i + 3] = 255;
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) put(x, y, 0x3a3a3a);
  let oy = gap;
  rows.forEach((r, ri) => {
    let ox = gap;
    for (const c of r) {
      const bg = PALETTE[c.bg ?? defaultBg] as number;
      for (let y = 0; y < c.map.h; y++) {
        for (let x = 0; x < c.map.w; x++) {
          const v = c.map.data[y * c.map.w + x] as number;
          put(ox + x, oy + y, v ? (PALETTE[v] as number) : bg);
        }
      }
      ox += c.map.w + gap;
    }
    oy += rowH[ri] as number;
  });
  // Scale up.
  const SW = W * SCALE;
  const SH = H * SCALE;
  const out = new Uint8Array(SW * SH * 4);
  for (let y = 0; y < SH; y++) {
    for (let x = 0; x < SW; x++) {
      const si = (((y / SCALE) | 0) * W + ((x / SCALE) | 0)) * 4;
      const di = (y * SW + x) * 4;
      out[di] = px[si] as number;
      out[di + 1] = px[si + 1] as number;
      out[di + 2] = px[si + 2] as number;
      out[di + 3] = 255;
    }
  }
  return { rgba: out, w: SW, h: SH };
}

function write(name: string, s: { rgba: Uint8Array; w: number; h: number }): void {
  const p = join(OUT, name);
  writeFileSync(p, encodePng(s.rgba, s.w, s.h));
  console.log(p);
}

const only = process.argv[2];
const onlyAnim = process.argv[3];
for (const [id, spec] of Object.entries(SPECS)) {
  if (only && only !== id) continue;
  const rows: Cell[][] = ANIMS.filter((a) => !onlyAnim || onlyAnim.split(',').includes(a.name)).map((a) =>
    animPoses(id, a).map((p) => ({ map: renderPose(spec, p).map })),
  );
  write(onlyAnim ? `zoom-${id}-${onlyAnim}.png` : `char-${id}.png`, sheet(rows, 31));
}

// Roster comparison: idle 0, run 0-7, celebrate 2, lose 0, ready 0-1 for every character.
if (!only) {
  const pick = (id: string, name: string, i: number) =>
    animPoses(
      id,
      ANIMS.find((a) => a.name === name)!,
    )[i]!;
  const rows: Cell[][] = Object.values(SPECS).map((spec) => [
    { map: renderPose(spec, pick(spec.id, 'idle', 0)).map },
    ...ANIMS.find((a) => a.name === 'run')!.poses.map((p) => ({ map: renderPose(spec, p).map, bg: 39 })),
    { map: renderPose(spec, pick(spec.id, 'celebrate', 2)).map },
    { map: renderPose(spec, pick(spec.id, 'lose', 0)).map },
    { map: renderPose(spec, pick(spec.id, 'ready', 0)).map },
    { map: renderPose(spec, pick(spec.id, 'ready', 1)).map },
  ]);
  write('roster.png', sheet(rows, 31));
}

if (process.env.HEADS) {
  const pick = (name: string, i: number) => ANIMS.find((a) => a.name === name)!.poses[i]!;
  const rows: Cell[][] = [
    Object.values(SPECS).map((spec) => ({ map: renderPose(spec, pick('idle', 0)).map })),
    Object.values(SPECS).map((spec) => ({ map: renderPose(spec, pick('run', 4)).map, bg: 39 })),
  ];
  write('heads.png', sheet(rows, 31));
}

// Extras and effects.
if (!only || only === 'extras') {
  const { buildCharacter, CHARACTER_IDS } = await import('../../src/art/chars/index.ts');
  const { buildEffects } = await import('../../src/art/sprites/effects.ts');
  const rows: Cell[][] = [];
  for (const id of CHARACTER_IDS) {
    const art = buildCharacter(id);
    const extra = art.anims.filter((a) => !ANIMS.some((b) => b.name === a.name));
    for (const a of extra)
      rows.push(a.frames.map((n) => ({ map: art.frames.find((f) => f.name === n)!.map })));
  }
  write('extras.png', sheet(rows, 31));
  write(
    'effects.png',
    sheet(
      buildEffects().map((d) => d.frames.map((map) => ({ map, bg: 39 }))),
      39,
    ),
  );
}

if (!only || only === 'icons') {
  const { buildIcon, ICON_NAMES, keyIcon } = await import('../../src/art/sprites/icons.ts');
  const states = ['dim', 'bright', 'wrong'] as const;
  write(
    'icons.png',
    sheet(
      [
        ICON_NAMES.map((n) => ({ map: buildIcon(n) })),
        states.flatMap((s) => [{ map: keyIcon('L', s) }, { map: keyIcon('R', s) }]),
      ],
      2,
    ),
  );
}

if (!only || only === 'portraits') {
  const { portrait16, portrait48, lockedPortrait } = await import('../../src/art/sprites/portraits.ts');
  const { CHARACTER_IDS } = await import('../../src/art/chars/index.ts');
  write(
    'portraits.png',
    sheet(
      [
        CHARACTER_IDS.map((id) => ({ map: portrait48(id) })),
        CHARACTER_IDS.map((id) => ({ map: portrait16(id) })),
        CHARACTER_IDS.map((id) => ({ map: lockedPortrait(portrait16(id)) })),
        CHARACTER_IDS.slice(0, 3).map((id) => ({ map: lockedPortrait(portrait48(id)) })),
      ],
      2,
    ),
  );
}

// Mock race screenshots: see the v3 section (6 lanes, layout R).

if (process.env.ANIM) {
  const a = ANIMS.find((x) => x.name === process.env.ANIM)!;
  write(
    `anim-${a.name}.png`,
    sheet(
      Object.values(SPECS).map((spec) =>
        animPoses(spec.id, a).map((p) => ({ map: renderPose(spec, p).map })),
      ),
      31,
    ),
  );
}

// ---------------------------------------------------------------------------
// v2 sheets (design 19): Sol, hurdle anims over a real hurdle, tired run, props.
// ---------------------------------------------------------------------------
const v2 = async () => {
  const { buildCharacter, HURDLERS } = await import('../../src/art/chars/index.ts');
  const P = await import('../../src/art/stadium/props.ts');
  const { createMap, blit } = await import('../../src/art/bake/index.ts');
  const { buildEffects } = await import('../../src/art/sprites/effects.ts');
  const frameOf = (id: string, name: string) =>
    buildCharacter(id as never).frames.find((f) => f.name === name)!.map;

  if (!only || only === 'sol') {
    const sol = buildCharacter('sol');
    const { portrait16, portrait48, lockedPortrait } = await import('../../src/art/sprites/portraits.ts');
    const rows: Cell[][] = sol.anims.map((a) =>
      a.frames.map((n) => ({
        map: sol.frames.find((f) => f.name === n)!.map,
        bg: a.name === 'run' ? 39 : 31,
      })),
    );
    // Watch glance overlay rows: upper-body pose 0 and 1 over every run leg frame.
    for (const k of [0, 1])
      rows.push(
        [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({
          map: sol.frames.find((f) => f.name === `watch${k}_${i}`)!.map,
          bg: 39,
        })),
      );
    rows.push([
      { map: portrait48('sol'), bg: 2 },
      { map: lockedPortrait(portrait48('sol')), bg: 2 },
      { map: portrait16('sol'), bg: 2 },
      { map: lockedPortrait(portrait16('sol')), bg: 2 },
      { map: portrait48('rio'), bg: 2 },
      { map: portrait48('kofi'), bg: 2 },
    ]);
    // Line-up next to the cast for scale and distinctness.
    rows.push(
      ['rio', 'kofi', 'valentina', 'zyx', 'sol'].map((id) => ({ map: frameOf(id, 'idle0') })),
      ['rio', 'kofi', 'valentina', 'zyx', 'sol'].map((id) => ({ map: frameOf(id, 'run2'), bg: 39 })),
    );
    write('sol.png', sheet(rows, 31));
  }

  if (!only || only === 'hurdle') {
    // Raw frames, then each character composited along the arc over a hurdle on the track.
    write(
      'anim-hurdle.png',
      sheet(
        HURDLERS.map((id) => [0, 1, 2, 3].map((i) => ({ map: frameOf(id, `hurdle${i}`) }))),
        31,
      ),
    );
    const SAMPLES = [0.06, 0.2, 0.32, 0.5, 0.62, 0.78, 0.94];
    const cell = (id: string, s: number) => {
      const W = 72;
      const H = 84;
      const ground = 76;
      const m = createMap(W, H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) m.data[y * W + x] = y > ground ? 39 : 31;
      for (let x = 0; x < W; x++) m.data[(ground + 4) * W + x] = 8;
      const pivot = 30;
      // Clean jump: crossing at s = 0.5, speed 10 m/s, airtime 0.4 s (4 m = 96 px).
      const hx = Math.round(pivot + (0.5 - s) * 96);
      const raise = Math.round(4 * 1.3 * s * (1 - s) * 24);
      const sh = P.airShadow(P.airShadowIndex(raise));
      blit(m, sh, pivot - (sh.w >> 1), ground - 1);
      blit(m, P.hurdleStanding(), hx - P.HURDLE_FRAME.pivotX, ground + 1 - P.HURDLE_FRAME.pivotY);
      const f = Math.min(3, Math.floor(4 * s));
      blit(m, frameOf(id, `hurdle${f}`), pivot - 24, ground + 1 - 47 - raise);
      return m;
    };
    write(
      'hurdle-arc.png',
      sheet(
        HURDLERS.map((id) => SAMPLES.map((s) => ({ map: cell(id, s) }))),
        31,
      ),
    );
    write(
      'anim-tired.png',
      sheet(
        [
          [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ map: frameOf('rio', `run${i}`), bg: 39 })),
          [0, 1, 2, 3, 4, 5, 6, 7].map((i) => ({ map: frameOf('rio', `tired${i}`), bg: 39 })),
        ],
        31,
      ),
    );
  }

  if (!only || only === 'ui') {
    const { buildIcon, keyIcon, rotatePhone } = await import('../../src/art/sprites/icons.ts');
    const { eventPictogram, PICTOGRAM_EVENTS } = await import('../../src/art/sprites/events.ts');
    const states = ['dim', 'bright', 'wrong'] as const;
    const v2icons = [
      'crown',
      'newBadge',
      'pause',
      'staminaArrowUp',
      'staminaArrowDown',
      'lapOval',
      'hurdleTick',
      'hurdleTickHit',
    ] as const;
    write(
      'ui-icons.png',
      sheet(
        [
          PICTOGRAM_EVENTS.flatMap((e) => [
            { map: eventPictogram(e, 32) },
            { map: eventPictogram(e, 32, true) },
          ]),
          PICTOGRAM_EVENTS.flatMap((e) => [
            { map: eventPictogram(e, 16) },
            { map: eventPictogram(e, 16, true) },
          ]),
          states.map((st) => ({ map: keyIcon('U', st) })),
          v2icons.map((n) => ({ map: buildIcon(n) })),
          [0, 1, 2, 3].map((i) => ({ map: rotatePhone(i) })),
        ],
        2,
      ),
    );
    const { touchArt, TOUCH_ART_DESIGN_STATES } = await import('../../src/art/sprites/touch.ts');
    // Touch art over a busy race frame (track colour) and on black, to check the pads stay hollow.
    write(
      'touch.png',
      sheet(
        (['padL', 'padR', 'padJump', 'pause'] as const).flatMap((id) => [
          TOUCH_ART_DESIGN_STATES[id].map((st) => ({ map: touchArt(id, st), bg: 39 })),
          TOUCH_ART_DESIGN_STATES[id].map((st) => ({ map: touchArt(id, st), bg: 1 })),
        ]),
        39,
      ),
    );
  }

  if (!only || only === 'props') {
    const fx = buildEffects();
    const clip = fx.find((d) => d.name === 'clip')!;
    const sweat = fx.find((d) => d.name === 'sweat')!;
    write(
      'props.png',
      sheet(
        [
          [{ map: P.hurdleStanding() }, ...P.hurdleKnockFrames().map((map) => ({ map }))],
          [...clip.frames.map((map) => ({ map })), ...sweat.frames.map((map) => ({ map }))],
          [
            ...[50, 150, 250, 350].map((d) => ({ map: P.board50(d) })),
            ...[100, 200, 300].map((d) => ({ map: P.splitBoard(d) })),
          ],
          [
            { map: P.bellOfficial(0), bg: 25 },
            { map: P.bellOfficial(1), bg: 25 },
            ...[0, 1, 2, 3].map((i) => ({ map: P.airShadow(i), bg: 39 })),
          ],
        ],
        31,
      ),
    );
  }
};
await v2();

// ---------------------------------------------------------------------------
// v3 sheets (design 35): field bodies, lineup, Rio's trip, officials, UI art, 6-lane race frames.
// ---------------------------------------------------------------------------
const v3 = async () => {
  const F = await import('../../src/art/chars/field.ts');
  const ZOOM = Number(process.env.ZOOM ?? 1);
  const zoomMap = (m: IndexMap): IndexMap => {
    if (ZOOM === 1) return m;
    const out = { w: m.w * ZOOM, h: m.h * ZOOM, data: new Uint8Array(m.w * m.h * ZOOM * ZOOM) };
    for (let y = 0; y < out.h; y++)
      for (let x = 0; x < out.w; x++)
        out.data[y * out.w + x] = m.data[((y / ZOOM) | 0) * m.w + ((x / ZOOM) | 0)]!;
    return out;
  };

  if (!only || only === 'field') {
    // One sheet per body: the 4 variants, every anim on its own row.
    for (const body of F.FIELD_BODIES) {
      const rows: Cell[][] = [];
      const arts = F.FIELD_VARIANTS.map((v) => F.buildField(body, v));
      const first = arts[0]!;
      for (const a of first.anims) {
        for (const art of arts) {
          const an = art.anims.find((x) => x.name === a.name)!;
          rows.push(
            an.frames.map((n) => ({
              map: zoomMap(art.frames.find((f) => f.name === n)!.map),
              bg: a.name === 'run' || a.name === 'hurdle' ? 39 : 31,
            })),
          );
        }
      }
      write(`field-${body}.png`, sheet(rows, 31));
      // Review strip: one row per variant with the frames that matter most at race size.
      const pickNames = [
        'walk0',
        'ready0',
        'ready1',
        'run0',
        'run1',
        'run2',
        'run3',
        'run4',
        'run5',
        'run6',
        'run7',
        'lean1',
        'hurdle1',
        'stumble1',
        'celebrate1',
        'lose0',
      ];
      write(
        `field-${body}-review.png`,
        sheet(
          arts.map((art) =>
            pickNames.map((n) => ({
              map: zoomMap(art.frames.find((f) => f.name === n)!.map),
              bg: n.startsWith('run') || n.startsWith('hurdle') ? 39 : 31,
            })),
          ),
          31,
        ),
      );
    }
  }
  if (!only || only === 'field' || only === 'lineup') {
    // All 28 variants: standing (walk1) and mid-stride (run2) per variant, one body per row,
    // with Rio and the tier's named rival at the row end for scale and distinctness.
    const RIVAL = ['pip', 'jess', 'marco', 'kofi', 'valentina', 'unit7', 'zyx'] as const;
    const { buildCharacter } = await import('../../src/art/chars/index.ts');
    const rows: Cell[][] = F.FIELD_BODIES.map((body, i) => {
      const cells: Cell[] = [];
      for (const v of F.FIELD_VARIANTS) {
        const art = F.buildField(body, v);
        cells.push({ map: art.frames.find((f) => f.name === 'walk1')!.map });
        cells.push({ map: art.frames.find((f) => f.name === 'run2')!.map, bg: 39 });
      }
      for (const id of ['rio', RIVAL[i]!]) {
        cells.push({ map: buildCharacter(id as never).frames.find((f) => f.name === 'run2')!.map, bg: 25 });
      }
      return cells;
    });
    write('field-lineup.png', sheet(rows, 31));
  }
  if (!only || only === 'officials') {
    const O = await import('../../src/art/stadium/officials.ts');
    const { buildCharacter } = await import('../../src/art/chars/index.ts');
    const { blit: blitMap } = await import('../../src/art/bake/index.ts');
    const helmet = O.starterHelmet();
    const withHelmet = (m: IndexMap) => {
      const c = { w: m.w, h: m.h, data: m.data.slice() };
      blitMap(c, helmet, 0, 0);
      return c;
    };
    const rio = buildCharacter('rio');
    const rioFrame = (n: string) => rio.frames.find((f) => f.name === n)!.map;
    write(
      'officials.png',
      sheet(
        [
          O.STARTER_FRAMES.map((f) => ({ map: O.starter(f), bg: 3 })),
          [
            ...O.STARTER_FRAMES.map((f) => ({ map: withHelmet(O.starter(f)), bg: 42 })),
            { map: helmet, bg: 42 },
          ],
          [...O.pistolSmoke().map((map) => ({ map, bg: 3 })), { map: O.judgeBench(), bg: 3 }],
          [0, 1, 2].flatMap((v) => O.JUDGE_FRAMES.map((f) => ({ map: O.judge(v, f), bg: 3 }))),
          [
            { map: O.photoCamera(false), bg: 3 },
            { map: O.photoCamera(true), bg: 3 },
            { map: O.bellOfficial(0), bg: 3 },
            { map: O.bellOfficial(1), bg: 3 },
          ],
          // Rio's trip (design 33.2): fall 3, lie 1, getup 3.
          ['fall0', 'fall1', 'fall2', 'lie0', 'getup0', 'getup1', 'getup2', 'run0'].map((n) => ({
            map: rioFrame(n),
            bg: 39,
          })),
        ],
        31,
      ),
    );
  }

  if (!only || only === 'ui3') {
    const M = await import('../../src/art/sprites/meets.ts');
    const { buildIcon } = await import('../../src/art/sprites/icons.ts');
    write(
      'ui-v3.png',
      sheet(
        [
          M.MEET_TIERS.map((t) => ({ map: M.meetBadge(t) })),
          [
            ...M.MEDAL_PLACES.map((p) => ({ map: M.medalPip(p) })),
            ...M.MEDAL_PLACES.map((p) => ({ map: M.medal(p) })),
            { map: buildIcon('finishFlagSmall') },
            { map: buildIcon('offscreenArrowLeft') },
            { map: buildIcon('offscreenArrow') },
            { map: M.speechBubble(), bg: 4 },
            { map: M.speechBubbleTail(), bg: 4 },
          ],
          [
            ...[0, 1, 2, 3].map((i) => ({ map: M.landingBeam(i), bg: 42 })),
            { map: M.landingBeam('static'), bg: 42 },
          ],
        ],
        2,
      ),
    );
  }
  if (!only || only === 'race' || only === 'stadium') await raceFrames();
};

/**
 * Mock race frames (320x180) composed with the same view math, lane geometry and draw order as
 * RaceView: layers, slanted lines, boards and officials on the far side, then lanes far to near
 * (hurdles, shadow, runner), then the L5 foreground.
 */
async function raceFrames(): Promise<void> {
  const L = await import('../../src/art/stadium/layers.ts');
  const P = await import('../../src/art/stadium/props.ts');
  const O = await import('../../src/art/stadium/officials.ts');
  const V = await import('../../src/art/view/camera.ts');
  const LN = await import('../../src/art/view/lanes.ts');
  const { airRaisePx, hurdleFrameIndex } = await import('../../src/art/view/runner.ts');
  const { buildCharacter } = await import('../../src/art/chars/index.ts');
  const F = await import('../../src/art/chars/field.ts');
  const { buildEffects } = await import('../../src/art/sprites/effects.ts');
  const { createMap, blit } = await import('../../src/art/bake/index.ts');
  const tile = (dst: IndexMap, src: IndexMap, y: number, off: number) => {
    for (let x = -V.mod(off, src.w); x < dst.w; x += src.w) blit(dst, src, x, y);
  };
  // Mirrors core hurdlePositions('110mh') (design 13.1); tools import only pure art modules.
  const HURDLES_M = [13.72, 22.86, 32.0, 41.14, 50.28, 59.42, 68.56, 77.7, 86.84, 95.98];
  const RIVAL = ['pip', 'jess', 'marco', 'kofi', 'valentina', 'unit7', 'zyx'] as const;
  const frameCache = new Map<string, Map<string, IndexMap>>();
  const framesOf = (key: string): Map<string, IndexMap> => {
    let m = frameCache.get(key);
    if (!m) {
      const [body, variant] = key.split('.');
      const art = variant ? F.buildField(body as never, variant as never) : buildCharacter(key as never);
      m = new Map(art.frames.map((f) => [f.name, f.map]));
      frameCache.set(key, m);
    }
    return m;
  };
  interface Lane {
    /** Character id ('rio') or field key ('fClub.B'). */
    readonly who: string;
    readonly xM: number;
    readonly frame: string;
    readonly airM?: number;
    readonly knocked?: readonly number[];
  }
  interface Shot {
    readonly tier: number;
    readonly distanceM: number;
    readonly event?: '100m' | '110mh' | '400m';
    /** Lane 0 (player) to 5. */
    readonly lanes: readonly Lane[];
    readonly playerM?: number;
    readonly starter?: 'idle0' | 'idle1' | 'armUp' | 'fire' | 'point';
    readonly smoke?: number;
    readonly judges?: 'sit0' | 'lean' | 'stand';
    readonly cameraOn?: boolean;
    readonly bellFrame?: 0 | 1;
    readonly fx?: readonly (readonly [string, number, number, number])[];
  }
  const fxFrames = new Map(buildEffects().map((d) => [d.name, d.frames]));
  const screen = (o: Shot) => {
    const m = createMap(320, 180);
    const playerM = o.playerM ?? o.lanes[0]!.xM;
    const scroll = V.cameraScroll(V.worldX(playerM), o.distanceM);
    const ev = o.event ?? '100m';
    blit(m, L.skyLayer(o.tier), 0, 0);
    tile(m, L.farLayer(o.tier, ev), L.LAYERS.far.y, V.layerScroll(scroll, L.LAYERS.far.factor));
    tile(m, L.standsLayer(o.tier, 0), L.LAYERS.stands.y, V.layerScroll(scroll, L.LAYERS.stands.factor));
    tile(m, L.nearLayer(o.tier, ev), L.LAYERS.near.y, V.layerScroll(scroll, L.LAYERS.near.factor));
    tile(m, L.trackLayer(o.tier), L.LAYERS.track.y, scroll);
    blit(m, L.startLine(o.tier), V.VIEW.START_X_PX - L.MARKING_LEFT - scroll, L.MARKING_TOP);
    blit(m, L.finishLine(), V.finishXPx(o.distanceM) - L.MARKING_LEFT - scroll, L.MARKING_TOP);
    const far = L.laneOffsetPx(5);
    const foot = L.LAYERS.track.y + 1;
    if (o.distanceM === 400) {
      for (const d of [50, 150, 250, 350])
        blit(m, P.board50(d), Math.round(V.worldX(d)) - 8 + far - scroll, foot - 11);
      for (const d of [100, 200, 300])
        blit(m, P.splitBoard(d), Math.round(V.worldX(d)) - 12 + far - scroll, foot - 15);
    } else {
      for (let d = 10; d < o.distanceM; d += 10)
        blit(m, L.distanceBoard(d), Math.round(V.worldX(d)) - 6 + far - scroll, foot - 13);
    }
    // Officials (RaceView constants: starter 20 px past the line's far end, bench 12, camera 2).
    const end = L.rowOffsetPx(L.MARKING_TOP);
    const offTop = L.FAR_SIDE_FEET_Y - O.OFFICIAL_FRAME.feetRow;
    const sx = V.VIEW.START_X_PX + end + 20 - scroll - 16;
    blit(m, O.starter(o.starter ?? 'idle0'), sx, offTop);
    if (o.tier === 7) blit(m, O.starterHelmet(), sx, offTop);
    if (o.smoke !== undefined) blit(m, O.pistolSmoke()[o.smoke]!, sx + 10 - 8, offTop + 3 - 16);
    const fx0 = V.finishXPx(o.distanceM);
    const bx = fx0 + end + 8 - scroll;
    blit(m, O.judgeBench(), bx, L.FAR_SIDE_FEET_Y - 16 + 1 + O.JUDGE_SEAT_ROW);
    for (let v = 0; v < 3; v++) {
      const pose = o.judges === 'stand' && v !== 1 ? 'lean' : (o.judges ?? 'sit0');
      blit(m, O.judge(v, pose), bx + 2 + v * 14, L.FAR_SIDE_FEET_Y + 1 - 16);
    }
    blit(m, O.photoCamera(o.cameraOn ?? false), fx0 + end + 2 - 4 - scroll, L.FAR_SIDE_FEET_Y + 1 - 40);
    if (o.bellFrame !== undefined)
      blit(m, O.bellOfficial(o.bellFrame), Math.round(V.worldX(300)) + far + 24 - 16 - scroll, offTop);
    // Lanes far to near: hurdles, shadow, runner (design 26.3).
    for (let lane = 5; lane >= 0; lane--) {
      const r = o.lanes[lane];
      if (!r) continue;
      const feet = LN.laneFeetY(lane);
      if (ev === '110mh') {
        HURDLES_M.forEach((h, i) => {
          const hx = Math.round(V.worldX(h)) + L.laneOffsetPx(lane) - scroll;
          if (!LN.hurdleVisible(hx)) return;
          const hm = r.knocked?.includes(i) ? P.hurdleKnockFrames()[3]! : P.hurdleStanding();
          blit(m, hm, hx - P.HURDLE_FRAME.pivotX, feet + 1 - P.HURDLE_FRAME.pivotY);
        });
      }
      const x = LN.runnerScreenX(lane, r.xM, scroll);
      const raise = airRaisePx(r.airM ?? 0);
      const sh = P.airShadow(P.airShadowIndex(raise));
      blit(m, sh, x - (sh.w >> 1), feet - 1);
      const fr = framesOf(r.who).get(r.frame);
      if (!fr) throw new Error(`no frame ${r.frame} for ${r.who}`);
      blit(m, fr, x - 24, feet - 46 - raise);
    }
    for (const [name, i, wx, by] of o.fx ?? [])
      blit(m, fxFrames.get(name as never)![i]!, wx - scroll - 8, by - 16);
    tile(m, L.fgLayer(o.tier), L.LAYERS.fg.y, V.layerScroll(scroll, L.LAYERS.fg.factor));
    return m;
  };
  const fieldOf = (tier: number, order: readonly number[]) =>
    order.map((i) => `${F.FIELD_BODIES[tier - 1]}.${F.FIELD_VARIANTS[i]}`);
  const cast = (tier: number, order: readonly number[] = [0, 1, 2, 3]) => [
    'rio',
    RIVAL[tier - 1] as string,
    ...fieldOf(tier, order),
  ];
  const lanesAt = (who: readonly string[], xs: readonly number[], frames: readonly string[]): Lane[] =>
    who.map((w, i) => ({ who: w, xM: xs[i]!, frame: frames[i]! }));
  const one = (map: IndexMap) => sheet([[{ map }]], 2, 0);

  // 100 m bunched (the worst case, design 38): all six within 0.6 m mid-race, tier 4.
  const bunched = screen({
    tier: 4,
    distanceM: 100,
    lanes: lanesAt(
      cast(4, [1, 3, 0, 2]),
      [52, 52.1, 51.8, 52.3, 52.0, 51.7],
      ['run2', 'run6', 'run4', 'run0', 'run3', 'run7'],
    ),
  });
  write('race-bunched.png', one(bunched));
  // 100 m spread with a leader off-screen, tier 1, the judges leaning (late race, last 10 m).
  write(
    'race-finish.png',
    one(
      screen({
        tier: 1,
        distanceM: 100,
        judges: 'lean',
        cameraOn: true,
        lanes: lanesAt(
          cast(1, [2, 0, 3, 1]),
          [97.4, 98, 96.8, 98.6, 96, 97.5],
          ['run1', 'run5', 'run3', 'run0', 'run6', 'run2'],
        ),
      }),
    ),
  );
  // Start in the blocks, tier 2, starter arm up on "1"; tier 7 fire with smoke and the helmet.
  write(
    'race-start.png',
    sheet(
      [
        [
          {
            map: screen({
              tier: 2,
              distanceM: 100,
              starter: 'armUp',
              lanes: lanesAt(cast(2), [0, 0, 0, 0, 0, 0], Array(6).fill('ready1')),
            }),
          },
        ],
        [
          {
            map: screen({
              tier: 7,
              distanceM: 100,
              starter: 'fire',
              smoke: 1,
              lanes: lanesAt(cast(7, [2, 0, 3, 1]), [0, 0, 0, 0, 0, 0], Array(6).fill('ready1')),
            }),
          },
        ],
      ],
      2,
      2,
    ),
  );
  // Hurdles: every lane over its own gate at H4, tier 3 and tier 6, one knocked hurdle.
  const air = (s: number) => 4 * 1.3 * s * (1 - s);
  const hl = (who: string, h: number, s: number, knocked: number[] = []): Lane => ({
    who,
    xM: h + (s - 0.5) * 4,
    frame: s < 0 || s > 1 ? `run${Math.round(Math.abs(s * 7)) % 8}` : `hurdle${hurdleFrameIndex(s)}`,
    airM: s < 0 || s > 1 ? 0 : air(s),
    knocked,
  });
  const hurdleShot = (tier: number, h: number, phases: readonly number[]) =>
    screen({
      tier,
      distanceM: 110,
      event: '110mh',
      lanes: cast(tier, [3, 1, 2, 0]).map((w, i) => hl(w, h, phases[i]!, i === 2 ? [2] : [])),
    });
  write(
    'race-hurdles.png',
    sheet(
      [
        [{ map: hurdleShot(3, 41.14, [0.5, 0.8, 0.3, -0.4, 0.62, 0.15]) }],
        [{ map: hurdleShot(6, 59.42, [0.2, 0.95, 0.45, 0.7, -0.3, 0.55]) }],
      ],
      2,
      2,
    ),
  );
  // 400 m at the bell, tier 5 with Sol, the official ringing on the far side.
  write(
    'race-400.png',
    one(
      screen({
        tier: 5,
        distanceM: 400,
        event: '400m',
        bellFrame: 1,
        lanes: lanesAt(
          ['rio', 'sol', ...fieldOf(5, [2, 0, 3, 1])],
          [296, 299, 297.5, 300.4, 295.2, 298.6],
          ['tired3', 'run6', 'run1', 'run4', 'run7', 'run2'],
        ),
        fx: [['sweat', 1, Math.round(V.worldX(296)) - 4, 124]],
      }),
    ),
  );
  // Rio's trip mid-race, tier 4: lying while the pack passes.
  write(
    'race-trip.png',
    one(
      screen({
        tier: 4,
        distanceM: 100,
        lanes: lanesAt(
          cast(4),
          [40, 41.5, 42, 41.2, 40.6, 42.4],
          ['lie0', 'run2', 'run6', 'run0', 'run4', 'run1'],
        ),
      }),
    ),
  );
  // Every tier's theme with its own cohort, mid-race.
  const all = RIVAL.map((_, i) => [
    {
      map: screen({
        tier: i + 1,
        distanceM: 100,
        lanes: lanesAt(
          cast(i + 1, [(i + 1) % 4, (i + 2) % 4, (i + 3) % 4, i % 4]),
          [30 + i * 9, 31 + i * 9, 29.6 + i * 9, 31.8 + i * 9, 30.4 + i * 9, 32.6 + i * 9],
          ['run0', 'run3', 'run5', 'run1', 'run6', 'run2'],
        ),
      }),
    },
  ]);
  write('tiers.png', sheet(all, 2, 2));
  if (process.env.TIER) {
    const i = Number(process.env.TIER) - 1;
    write(`tier-${i + 1}.png`, sheet([all[i]!], 2, 0));
  }
}
await v3();
