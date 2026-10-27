/**
 * Optional CRT look (research 3): slight barrel curvature, scanlines and a vignette on a camera's
 * external filter list. WebGL only; a no-op under the Canvas renderer. Off by default.
 *
 * Scanlines are a 320x180 mask multiplied over the view after the barrel pass, so every second
 * internal pixel row is dimmed a little: whole-row and straight, aligned to the 320x180 grid
 * (the canvas renders at 320x180 and is scaled by CSS, so a finer line is not possible).
 */
import type Phaser from 'phaser';

/** Internal resolution (design 5.1). */
const GAME_WIDTH_PX = 320;
const GAME_HEIGHT_PX = 180;

const WEBGL = 2; // Phaser.WEBGL (src/const.js)
const MULTIPLY = 2; // Phaser.BlendModes.MULTIPLY
const SCANLINE_KEY = 'art.crt.scanlines';
/** How much the dark rows are dimmed (0 = none, 1 = black). Kept subtle. */
const SCANLINE_AMOUNT = 0.14;

const active = new WeakMap<Phaser.Cameras.Scene2D.Camera, Phaser.Filters.Controller[]>();

/** Odd rows black, even rows white; the Blend filter multiplies it in at SCANLINE_AMOUNT. */
function ensureScanlines(scene: Phaser.Scene): string {
  const textures = scene.sys.textures;
  if (textures.exists(SCANLINE_KEY)) return SCANLINE_KEY;
  const tex = textures.createCanvas(SCANLINE_KEY, GAME_WIDTH_PX, GAME_HEIGHT_PX);
  if (!tex) return SCANLINE_KEY;
  const ctx = tex.getContext();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, GAME_WIDTH_PX, GAME_HEIGHT_PX);
  ctx.fillStyle = '#000000';
  for (let y = 1; y < GAME_HEIGHT_PX; y += 2) ctx.fillRect(0, y, GAME_WIDTH_PX, 1);
  tex.refresh();
  return SCANLINE_KEY;
}

export function setCrtImpl(camera: Phaser.Cameras.Scene2D.Camera, on: boolean): void {
  if (camera.scene.sys.game.renderer.type !== WEBGL) return;
  const list = camera.filters?.external;
  if (!list) return;
  const current = active.get(camera);
  if (on && !current) {
    const key = ensureScanlines(camera.scene);
    active.set(camera, [
      list.addBarrel(1.03),
      list.addBlend(key, MULTIPLY, SCANLINE_AMOUNT),
      list.addVignette(0.5, 0.5, 0.95, 0.35, 0x0b0b14),
    ]);
  } else if (!on && current) {
    for (const f of current) list.remove(f, true);
    active.delete(camera);
  }
}
