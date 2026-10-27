/** Touch art as PNG data URLs (design 17.4). Pure: no Phaser, no DOM, so the touch layer and tests can use it. */
import { encodeIndexedPng, pngDataUrl } from './png.ts';
import { touchArt, type TouchArtId, type TouchArtState } from './sprites/touch.ts';

const touchCache = new Map<string, string>();
/**
 * Pixel-perfect PNG data URL of a touch control at an integer scale (design 17.4), for the DOM
 * overlay. Pure and synchronous (no Phaser, no canvas), cached per (id, state, scale).
 * Sizes in game px: padL/padR 64x48, padJump 64x40, pause 16x16, rotatePhone 32x32.
 * States a control does not distinguish draw like the nearest one it does: padJump treats
 * 'expected' as 'ready' and 'blocked'/'fumble' with the run pads' colours; pause has idle/pressed;
 * rotatePhone ignores the state (frame 0, use rotatePhoneUrl for the turn animation).
 */
export function touchArtUrl(id: TouchArtId, state: TouchArtState, scale: number): string {
  return touchUrl(id, state, scale, 0);
}

/** Addition: rotate-phone frame 0-3 (0, 30, 60, 90 degrees) as a data URL, for the DOM rotate prompt. */
export function rotatePhoneUrl(frame: 0 | 1 | 2 | 3, scale: number): string {
  return touchUrl('rotatePhone', 'idle', scale, frame);
}

function touchUrl(id: TouchArtId, state: TouchArtState, scale: number, frame: number): string {
  const k = `${id}/${state}/${scale}/${frame}`;
  let url = touchCache.get(k);
  if (url === undefined) {
    url = pngDataUrl(encodeIndexedPng(touchArt(id, state, frame), { scale }));
    touchCache.set(k, url);
  }
  return url;
}
