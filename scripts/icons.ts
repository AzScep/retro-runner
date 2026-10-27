/**
 * Writes the Home Screen / PWA icons (design 19.3, research-mobile 5) to public/icons/:
 * `node scripts/icons.ts`. Integer nearest-neighbour upscales of the 32x32 app icon pixel map,
 * encoded with the art layer's own PNG encoder. Deterministic: re-running yields identical files.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeIndexedPng } from '../src/art/png.ts';
import { APP_ICON_BG, APP_ICONS, appIcon } from '../src/art/sprites/appIcon.ts';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(out, { recursive: true });
const map = appIcon();
for (const spec of APP_ICONS) {
  const png = encodeIndexedPng(map, { scale: spec.scale, background: APP_ICON_BG, canvas: spec.size });
  const p = join(out, spec.file);
  writeFileSync(p, png);
  console.log(`${p} ${spec.size}x${spec.size} (${spec.scale}x, ${png.length} bytes)`);
}
