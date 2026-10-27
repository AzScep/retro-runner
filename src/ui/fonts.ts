/**
 * Bitmap fonts baked at boot (research 4, design 6.1).
 *
 * - FONT_PS: Press Start 2P rasterised once at its native 8 px into a 1-bit atlas. The canvas
 *   rasteriser anti-aliases glyph edges slightly, so alpha is thresholded at 50 %: every surviving
 *   pixel is opaque white and every other pixel is fully transparent. Colour comes from tinting.
 * - FONT_MINI: the hand-authored 5x7 font from miniFont.ts.
 *
 * Both register as Phaser bitmap fonts, drawn only with BitmapText at integer scales. They share
 * one texture (Press Start 2P on top, the mini font below), so text never adds a second font
 * texture to a render batch (art is one atlas texture: see art/phaser/textures.ts).
 */
import type Phaser from 'phaser';
import pressStartUrl from '@fontsource/press-start-2p/files/press-start-2p-latin-400-normal.woff2?url';
import { MINI_CHARSET, MINI_GLYPHS, MINI_HEIGHT, MINI_LINE_HEIGHT, MINI_SPACE_ADVANCE } from './miniFont.ts';

export const FONT_PS = 'font-ps2p';
export const FONT_MINI = 'font-mini';
export type FontId = typeof FONT_PS | typeof FONT_MINI;

/** Native glyph size of each font in px (BitmapText size for 1x). */
export const FONT_SIZE: Readonly<Record<FontId, number>> = { [FONT_PS]: 8, [FONT_MINI]: MINI_HEIGHT };

const PS_FAMILY = 'RetroRunnerPressStart2P';
const PS_CELL = 8;
const PS_FIRST = 32;
const PS_LAST = 126;
const COLS = 16;
const ALPHA_THRESHOLD = 128;
const MINI_CELL_W = 6;
const MINI_CELL_H = MINI_HEIGHT + 1;
/** Texture holding both fonts' glyphs. */
const FONT_TEXTURE = 'font-atlas';

let psLoaded: Promise<void> | null = null;

/** Loads the Press Start 2P woff2 through the FontFace API (once). */
export function loadPressStart(): Promise<void> {
  psLoaded ??= (async () => {
    const face = new FontFace(PS_FAMILY, `url(${pressStartUrl})`);
    await face.load();
    document.fonts.add(face);
  })();
  return psLoaded;
}

interface GlyphRect {
  readonly code: number;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  readonly advance: number;
}

/** Same shape Phaser's ParseRetroFont produces (its typings for RetroFont.Parse are inaccurate). */
function registerFont(
  scene: Phaser.Scene,
  key: string,
  canvas: HTMLCanvasElement,
  size: number,
  lineHeight: number,
  glyphs: readonly GlyphRect[],
): void {
  const tw = canvas.width;
  const th = canvas.height;
  const chars: Record<number, unknown> = {};
  for (const g of glyphs) {
    chars[g.code] = {
      x: g.x,
      y: g.y,
      width: g.w,
      height: g.h,
      centerX: Math.floor(g.w / 2),
      centerY: Math.floor(g.h / 2),
      xOffset: 0,
      yOffset: 0,
      xAdvance: g.advance,
      data: {},
      kerning: {},
      u0: g.x / tw,
      v0: 1 - g.y / th,
      u1: (g.x + g.w) / tw,
      v1: 1 - (g.y + g.h) / th,
    };
  }
  scene.cache.bitmapFont.add(key, {
    data: { retroFont: true, font: key, size, lineHeight, chars },
    texture: FONT_TEXTURE,
    frame: null,
  });
}

/** Press Start 2P glyphs in a 16-column grid of 8 px cells from (0, 0). */
function bakePressStart(ctx: CanvasRenderingContext2D): GlyphRect[] {
  ctx.font = `${PS_CELL}px ${PS_FAMILY}`;
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#ffffff';
  const glyphs: GlyphRect[] = [];
  for (let code = PS_FIRST; code <= PS_LAST; code++) {
    const i = code - PS_FIRST;
    const x = (i % COLS) * PS_CELL;
    const y = Math.floor(i / COLS) * PS_CELL;
    ctx.fillText(String.fromCharCode(code), x, y);
    glyphs.push({ code, x, y, w: PS_CELL, h: PS_CELL, advance: PS_CELL });
  }
  return glyphs;
}

/** Every pixel becomes opaque white or fully transparent: no anti-aliased pixels survive. */
function thresholdAlpha(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let p = 0; p < d.length; p += 4) {
    const on = (d[p + 3] ?? 0) >= ALPHA_THRESHOLD;
    d[p] = 255;
    d[p + 1] = 255;
    d[p + 2] = 255;
    d[p + 3] = on ? 255 : 0;
  }
  ctx.putImageData(img, 0, 0);
}

/** Mini font glyphs in a 16-column grid of 6 x 8 cells from (0, top). */
function bakeMini(ctx: CanvasRenderingContext2D, top: number): GlyphRect[] {
  ctx.fillStyle = '#ffffff';
  const glyphs: GlyphRect[] = [];
  // Lowercase letters reuse the uppercase glyph rects so mixed-case strings still render.
  [...MINI_CHARSET].forEach((ch, i) => {
    const x = (i % COLS) * MINI_CELL_W;
    const y = top + Math.floor(i / COLS) * MINI_CELL_H;
    if (ch === ' ') {
      glyphs.push({ code: 32, x, y, w: 0, h: MINI_HEIGHT, advance: MINI_SPACE_ADVANCE });
      return;
    }
    const rowsOf = MINI_GLYPHS[ch] ?? [];
    const w = rowsOf[0]?.length ?? 0;
    rowsOf.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) if (row[rx] === '#') ctx.fillRect(x + rx, y + ry, 1, 1);
    });
    const rect = { x, y, w, h: MINI_HEIGHT, advance: w + 1 };
    glyphs.push({ code: ch.charCodeAt(0), ...rect });
    const lower = ch.toLowerCase();
    if (lower !== ch) glyphs.push({ code: lower.charCodeAt(0), ...rect });
  });
  return glyphs;
}

/** Bakes and registers both fonts. Call once from Boot after loadPressStart() resolved. */
export function registerFonts(scene: Phaser.Scene): void {
  if (scene.cache.bitmapFont.exists(FONT_PS)) return;
  const psH = Math.ceil((PS_LAST - PS_FIRST + 1) / COLS) * PS_CELL;
  const miniH = Math.ceil(MINI_CHARSET.length / COLS) * MINI_CELL_H;
  const canvas = document.createElement('canvas');
  canvas.width = COLS * Math.max(PS_CELL, MINI_CELL_W);
  // A 1 px gap keeps the two grids apart.
  canvas.height = psH + 1 + miniH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas unavailable for font baking');
  const ps = bakePressStart(ctx);
  thresholdAlpha(ctx, canvas.width, psH);
  const mini = bakeMini(ctx, psH + 1);
  scene.textures.addCanvas(FONT_TEXTURE, canvas);
  registerFont(scene, FONT_PS, canvas, PS_CELL, PS_CELL, ps);
  registerFont(scene, FONT_MINI, canvas, MINI_HEIGHT, MINI_LINE_HEIGHT, mini);
}
