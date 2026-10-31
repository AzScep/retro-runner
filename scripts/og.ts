/**
 * Writes the /welcome/ share image (Open Graph and Twitter card) to public/og.png:
 * `node scripts/og.ts`. 1200x630, a 3x upscale of a 400x210 scene built from the game's own art:
 * the World Games stadium, Rio and two rivals mid-stride, and the title in the RR Mini font.
 * Deterministic: re-running yields an identical file.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blit, createMap, encodeIndexedPng, type IndexMap } from '../src/art/landing.ts';
import {
  characterFrames,
  LANE_FEET_Y,
  stadiumScene,
  type LandingCharacterId,
} from '../src/landing/art/index.ts';
import { MINI_GLYPHS, MINI_HEIGHT, miniTextWidth, normaliseMini } from '../src/ui/miniFont.ts';

const W = 400;
const H = 210;
const SCALE = 3;
const BAND = 30;
// Palette indices (design 5.2).
const INK = 1;
const PANEL = 2;
const WHITE = 8;
const ORANGE = 20;
const YELLOW = 22;

/** Draws `text` in the mini font at an integer `zoom`, with a 1 art px drop shadow. */
function text(
  map: IndexMap,
  s: string,
  x: number,
  y: number,
  zoom: number,
  ink: number,
  shadow: number,
): void {
  for (const [dx, dy, c] of [[zoom, zoom, shadow] as const, [0, 0, ink] as const]) {
    let cx = x + dx;
    for (const ch of normaliseMini(s)) {
      const rows = MINI_GLYPHS[ch];
      if (!rows) {
        cx += 4 * zoom;
        continue;
      }
      rows.forEach((row, ry) => {
        for (let rx = 0; rx < row.length; rx++) {
          if (row[rx] !== '#') continue;
          for (let py = 0; py < zoom; py++)
            for (let px = 0; px < zoom; px++)
              map.data[(y + dy + ry * zoom + py) * map.w + cx + rx * zoom + px] = c;
        }
      });
      cx += (rows[0]!.length + 1) * zoom;
    }
  }
}

const map = createMap(W, H, PANEL);
blit(map, stadiumScene(5, { width: W, scroll: 40 }), 0, BAND);
for (let x = 0; x < W; x++) map.data[(BAND - 1) * W + x] = INK;

const title = 'RETRO RUNNER';
text(map, title, 8, Math.floor((BAND - 1 - MINI_HEIGHT * 2) / 2), 2, YELLOW, ORANGE);
const tag = 'MASH LEFT + RIGHT';
text(map, tag, W - 8 - miniTextWidth(tag), Math.floor((BAND - 1 - MINI_HEIGHT) / 2), 1, WHITE, INK);

// Lane, runner, run frame and x of each runner's feet; Rio leads in the nearest lane.
const runners: readonly [number, LandingCharacterId, number, number][] = [
  [2, 'kofi', 5, 196],
  [1, 'valentina', 3, 230],
  [0, 'rio', 1, 262],
];
for (const [lane, id, frame, x] of runners) {
  const clip = characterFrames(id, 'run');
  const f = clip.frames[frame % clip.frames.length]!;
  blit(map, f, x - clip.pivotX, BAND + LANE_FEET_Y[lane]! + 1 - clip.pivotY);
}

const png = encodeIndexedPng(map, { scale: SCALE });
const out = join(fileURLToPath(new URL('..', import.meta.url)), 'public', 'og.png');
writeFileSync(out, png);
console.log(`${out} ${W * SCALE}x${H * SCALE} (${png.length} bytes)`);
