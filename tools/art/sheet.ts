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

// Mock race screenshots (320x180) composed with the same view math and draw order as RaceView.
if (!only || only === 'stadium' || only === 'race') {
  const L = await import('../../src/art/stadium/layers.ts');
  const P = await import('../../src/art/stadium/props.ts');
  const V = await import('../../src/art/view/camera.ts');
  const { blocksOffsetPx, airRaisePx, hurdleFrameIndex } = await import('../../src/art/view/runner.ts');
  const { buildCharacter } = await import('../../src/art/chars/index.ts');
  const { buildEffects } = await import('../../src/art/sprites/effects.ts');
  const { createMap, blit } = await import('../../src/art/bake/index.ts');
  const tile = (dst: IndexMap, src: IndexMap, y: number, off: number) => {
    for (let x = -V.mod(off, src.w); x < dst.w; x += src.w) blit(dst, src, x, y);
  };
  // Mirrors core hurdlePositions('110mh') (design 13.1); tools import only pure art modules.
  const HURDLES_M = [13.72, 22.86, 32.0, 41.14, 50.28, 59.42, 68.56, 77.7, 86.84, 95.98];
  interface Lane {
    readonly id: string;
    readonly xM: number;
    readonly frame: string;
    readonly airM?: number;
    readonly knocked?: readonly number[];
  }
  interface Shot {
    readonly tier: number;
    readonly distanceM: number;
    readonly event?: '100m' | '110mh' | '400m';
    readonly player: Lane;
    readonly rival: Lane;
    readonly hurdles?: boolean;
    readonly bellFrame?: 0 | 1;
    /** Extra effects: [name, frame, worldX px, bottom y]. */
    readonly fx?: readonly (readonly [string, number, number, number])[];
  }
  const fxFrames = new Map(buildEffects().map((d) => [d.name, d.frames]));
  const screen = (o: Shot) => {
    const m = createMap(320, 180);
    const scroll = V.cameraScroll(V.worldX(o.player.xM), o.distanceM);
    blit(m, L.skyLayer(o.tier), 0, 0);
    tile(m, L.farLayer(o.tier, o.event ?? '100m'), 24, V.layerScroll(scroll, 0.1));
    tile(m, L.standsLayer(o.tier, 0), 48, V.layerScroll(scroll, 0.3));
    tile(m, L.nearLayer(o.tier, o.event ?? '100m'), 88, V.layerScroll(scroll, 0.6));
    tile(m, L.trackLayer(o.tier), 104, scroll);
    blit(m, L.startLine(o.tier), V.VIEW.START_X_PX - scroll, 108);
    blit(m, L.finishLine(), V.finishXPx(o.distanceM) - scroll, 108);
    if (o.distanceM === 400) {
      for (const d of [50, 150, 250, 350]) blit(m, P.board50(d), Math.round(V.worldX(d)) - 8 - scroll, 92);
      for (const d of [100, 200, 300]) blit(m, P.splitBoard(d), Math.round(V.worldX(d)) - 12 - scroll, 88);
    } else {
      for (let d = 10; d < o.distanceM; d += 10) blit(m, L.distanceBoard(d), V.worldX(d) - 6 - scroll, 92);
    }
    const lanes = [
      [o.rival, L.LANE_FEET_Y.rival],
      [o.player, L.LANE_FEET_Y.player],
    ] as const;
    // Shadows (depth 10) under everything in the lanes.
    for (const [r, feet] of lanes) {
      const sx = Math.round(V.worldX(r.xM)) + blocksOffsetPx(r.xM) - scroll;
      const sh = P.airShadow(P.airShadowIndex(airRaisePx(r.airM ?? 0)));
      blit(m, sh, sx - (sh.w >> 1), feet - 1);
    }
    // Rival-lane hurdles (15), rival (20), player-lane hurdles (25), player (30).
    for (const [r, feet] of lanes) {
      if (o.hurdles) {
        HURDLES_M.forEach((h, i) => {
          const knocked = r.knocked?.includes(i) ?? false;
          const hm = knocked ? P.hurdleKnockFrames()[3]! : P.hurdleStanding();
          blit(
            m,
            hm,
            Math.round(V.worldX(h)) +
              (feet === L.LANE_FEET_Y.rival ? P.FAR_LANE_HURDLE_OFFSET_PX : 0) -
              scroll -
              P.HURDLE_FRAME.pivotX,
            feet + 1 - P.HURDLE_FRAME.pivotY,
          );
        });
      }
      const art = buildCharacter(r.id as never);
      const sx = Math.round(V.worldX(r.xM)) + blocksOffsetPx(r.xM) - scroll;
      blit(m, art.frames.find((f) => f.name === r.frame)!.map, sx - 24, feet - 46 - airRaisePx(r.airM ?? 0));
    }
    for (const [name, i, wx, by] of o.fx ?? []) {
      const f = fxFrames.get(name as never)![i]!;
      blit(m, f, wx - scroll - 8, by - 16);
    }
    tile(m, L.fgLayer(o.tier), 160, V.layerScroll(scroll, 1.3));
    if (o.bellFrame !== undefined) {
      const s300 = Math.round(V.worldX(300)) - 96;
      const bx = 150 + V.layerScroll(s300, 1.3) - V.layerScroll(scroll, 1.3);
      blit(m, P.bellOfficial(o.bellFrame), bx, 155);
    }
    return m;
  };
  const run = (id: string, xM: number, i: number): Lane => ({ id, xM, frame: `run${i}` });
  write(
    'race-screen.png',
    sheet(
      [
        [
          {
            map: screen({ tier: 4, distanceM: 100, player: run('rio', 41.5, 2), rival: run('kofi', 43, 6) }),
          },
        ],
      ],
      2,
      0,
    ),
  );
  write(
    'race-start.png',
    sheet(
      [
        [
          {
            map: screen({
              tier: 1,
              distanceM: 100,
              player: { id: 'rio', xM: 0, frame: 'ready1' },
              rival: { id: 'pip', xM: 0, frame: 'ready1' },
            }),
          },
        ],
      ],
      2,
      0,
    ),
  );
  // Hurdles: the player at the peak over H4 (s = 0.5), the rival landing past H4, one rival hurdle
  // knocked earlier, a clip burst on the player's H3.
  const air = (s: number) => 4 * 1.3 * s * (1 - s);
  const hurdleLane = (id: string, h: number, s: number, knocked: number[] = []): Lane => ({
    id,
    xM: h + (s - 0.5) * 4,
    frame: `hurdle${hurdleFrameIndex(s)}`,
    airM: air(s),
    knocked,
  });
  write(
    'race-hurdles.png',
    sheet(
      [
        [
          {
            map: screen({
              tier: 3,
              distanceM: 110,
              event: '110mh',
              hurdles: true,
              player: hurdleLane('rio', 41.14, 0.5, [2]),
              rival: hurdleLane('marco', 41.14, 0.8, [1]),
            }),
          },
        ],
        [
          {
            map: screen({
              tier: 6,
              distanceM: 110,
              event: '110mh',
              hurdles: true,
              player: hurdleLane('rio', 59.42, 0.3),
              rival: hurdleLane('unit7', 59.42, 0.95),
            }),
          },
        ],
      ],
      2,
      2,
    ),
  );
  write(
    'race-400.png',
    sheet(
      [
        [
          {
            map: screen({
              tier: 5,
              distanceM: 400,
              event: '400m',
              player: { id: 'rio', xM: 296, frame: 'tired3' },
              rival: { id: 'sol', xM: 299, frame: 'run6' },
              bellFrame: 1,
              fx: [['sweat', 1, Math.round(V.worldX(296)) - 4, 124]],
            }),
          },
        ],
        [
          {
            map: screen({
              tier: 5,
              distanceM: 400,
              event: '400m',
              player: run('rio', 197, 1),
              rival: { id: 'sol', xM: 199, frame: 'watch1_6' },
            }),
          },
        ],
      ],
      2,
      2,
    ),
  );
  const ids = ['pip', 'jess', 'marco', 'kofi', 'valentina', 'unit7', 'zyx'];
  const all = ids.map((id, i) => [
    {
      map: screen({
        tier: i + 1,
        distanceM: 100,
        player: run('rio', 30 + i * 9, i % 8),
        rival: run(id, 31 + i * 9, (i + 3) % 8),
      }),
    },
  ]);
  write('tiers.png', sheet(all, 2, 2));
  if (process.env.TIER) {
    const i = Number(process.env.TIER) - 1;
    write(`tier-${i + 1}.png`, sheet([all[i]!], 2, 0));
  }
}

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
