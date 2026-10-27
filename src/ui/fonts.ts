/**
 * Bitmap fonts baked at boot (research 4, design 6.1).
 *
 * - FONT_PS: Press Start 2P rasterised once at its native 8 px into a 1-bit atlas. The canvas
 *   rasteriser anti-aliases glyph edges slightly, so alpha is thresholded at 50 %: every surviving
 *   pixel is opaque white and every other pixel is fully transparent. Colour comes from tinting.
 * - FONT_MINI: the hand-authored 5x7 font from miniFont.ts.
 *
 * Both register as Phaser bitmap fonts, drawn only with BitmapText at integer scales.
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
  scene.textures.addCanvas(key, canvas);
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
    texture: key,
    frame: null,
  });
}

function bakePressStart(scene: Phaser.Scene): void {
  const count = PS_LAST - PS_FIRST + 1;
  const rows = Math.ceil(count / COLS);
  const canvas = document.createElement('canvas');
  canvas.width = COLS * PS_CELL;
  canvas.height = rows * PS_CELL;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas unavailable for font baking');
  ctx.font = `${PS_CELL}px ${PS_FAMILY}`;
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#ffffff';
  const glyphs: GlyphRect[] = [];
  for (let i = 0; i < count; i++) {
    const code = PS_FIRST + i;
    const x = (i % COLS) * PS_CELL;
    const y = Math.floor(i / COLS) * PS_CELL;
    ctx.fillText(String.fromCharCode(code), x, y);
    glyphs.push({ code, x, y, w: PS_CELL, h: PS_CELL, advance: PS_CELL });
  }
  thresholdAlpha(ctx, canvas.width, canvas.height);
  registerFont(scene, FONT_PS, canvas, PS_CELL, PS_CELL, glyphs);
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

function bakeMini(scene: Phaser.Scene): void {
  const cellW = 6;
  const cellH = MINI_HEIGHT + 1;
  const chars = [...MINI_CHARSET];
  // Lowercase letters reuse the uppercase glyph rects so mixed-case strings still render.
  const rows = Math.ceil(chars.length / COLS);
  const canvas = document.createElement('canvas');
  canvas.width = COLS * cellW;
  canvas.height = rows * cellH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable for font baking');
  ctx.fillStyle = '#ffffff';
  const glyphs: GlyphRect[] = [];
  chars.forEach((ch, i) => {
    const x = (i % COLS) * cellW;
    const y = Math.floor(i / COLS) * cellH;
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
  registerFont(scene, FONT_MINI, canvas, MINI_HEIGHT, MINI_LINE_HEIGHT, glyphs);
}

/** Bakes and registers both fonts. Call once from Boot after loadPressStart() resolved. */
export function registerFonts(scene: Phaser.Scene): void {
  if (!scene.cache.bitmapFont.exists(FONT_PS)) bakePressStart(scene);
  if (!scene.cache.bitmapFont.exists(FONT_MINI)) bakeMini(scene);
}
