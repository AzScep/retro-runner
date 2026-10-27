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

// Mock race screenshots (320x180) composed with the same view math as RaceView.
if (!only || only === 'stadium') {
  const L = await import('../../src/art/stadium/layers.ts');
  const V = await import('../../src/art/view/camera.ts');
  const { blocksOffsetPx } = await import('../../src/art/view/runner.ts');
  const { buildCharacter } = await import('../../src/art/chars/index.ts');
  const { createMap, blit } = await import('../../src/art/bake/index.ts');
  const tile = (dst: IndexMap, src: IndexMap, y: number, off: number) => {
    for (let x = -V.mod(off, src.w); x < dst.w; x += src.w) blit(dst, src, x, y);
  };
  const screen = (
    tier: number,
    playerM: number,
    rivalM: number,
    pFrame: string,
    rFrame: string,
    rivalId: string,
  ) => {
    const m = createMap(320, 180);
    const scroll = V.cameraScroll(V.worldX(playerM));
    blit(m, L.skyLayer(tier), 0, 0);
    tile(m, L.farLayer(tier), 24, V.layerScroll(scroll, 0.1));
    tile(m, L.standsLayer(tier, 0), 48, V.layerScroll(scroll, 0.3));
    tile(m, L.nearLayer(tier), 88, V.layerScroll(scroll, 0.6));
    tile(m, L.trackLayer(tier), 104, scroll);
    blit(m, L.startLine(tier), V.VIEW.START_X_PX - scroll, 108);
    blit(m, L.finishLine(), V.FINISH_X_PX - scroll, 108);
    for (let d = 10; d < 100; d += 10) blit(m, L.distanceBoard(d), V.worldX(d) - 6 - scroll, 92);
    const runner = (id: string, xm: number, frame: string, feet: number) => {
      const art = buildCharacter(id as never);
      const sx = Math.round(V.worldX(xm)) + blocksOffsetPx(xm) - scroll;
      blit(m, L.groundShadow(), sx - 10, feet - 1);
      blit(m, art.frames.find((f) => f.name === frame)!.map, sx - 24, feet - 46);
    };
    runner(rivalId, rivalM, rFrame, L.LANE_FEET_Y.rival);
    runner('rio', playerM, pFrame, L.LANE_FEET_Y.player);
    tile(m, L.fgLayer(tier), 160, V.layerScroll(scroll, 1.3));
    return m;
  };
  const ids = ['pip', 'jess', 'marco', 'kofi', 'valentina', 'unit7', 'zyx'];
  write('race-screen.png', sheet([[{ map: screen(4, 41.5, 43, 'run2', 'run6', 'kofi') }]], 2, 0));
  write('race-start.png', sheet([[{ map: screen(1, 0, 0, 'ready1', 'ready1', 'pip') }]], 2, 0));
  const SC = Number(process.env.SCALE ?? 4);
  void SC;
  const all = ids.map((id, i) => [
    { map: screen(i + 1, 30 + i * 9, 31 + i * 9, `run${i % 8}`, `run${(i + 3) % 8}`, id) },
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
