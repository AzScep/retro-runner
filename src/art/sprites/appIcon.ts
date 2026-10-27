/**
 * Home Screen app icon (design 19.3, research-mobile 5): a 32x32 palette pixel map of Rio's head on
 * index 1. Cropped from Rio's 48x48 rival-card bust so the icon matches the in-game portrait.
 * scripts/icons.ts upscales it by whole numbers into public/icons/.
 */
import { createMap, crop, type IndexMap } from '../bake/index.ts';
import { portrait48 } from './portraits.ts';

export const APP_ICON_SIZE = 32;
export const APP_ICON_BG = 1;

export function appIcon(): IndexMap {
  const bust = crop(portrait48('rio'), 9, 2, APP_ICON_SIZE, APP_ICON_SIZE);
  const m = createMap(APP_ICON_SIZE, APP_ICON_SIZE, APP_ICON_BG);
  for (let i = 0; i < m.data.length; i++) if (bust.data[i]) m.data[i] = bust.data[i] as number;
  return m;
}

export interface AppIconSpec {
  readonly file: string;
  readonly size: number;
  /** Integer upscale of the 32 px map; the rest of the canvas is index 1 padding, centred. */
  readonly scale: number;
}

/**
 * Output files (public/icons/). 180 is not a multiple of 32, so it uses 5x (160 px) centred on a
 * 180 px index 1 canvas. The maskable icon keeps its art inside the 80 % safe circle: 12x = 384 px
 * of 512 (the corners of the 32 px map are background anyway).
 */
export const APP_ICONS: readonly AppIconSpec[] = [
  { file: 'apple-touch-icon.png', size: 180, scale: 5 },
  { file: 'icon-192.png', size: 192, scale: 6 },
  { file: 'icon-512.png', size: 512, scale: 16 },
  { file: 'icon-512-maskable.png', size: 512, scale: 12 },
];
