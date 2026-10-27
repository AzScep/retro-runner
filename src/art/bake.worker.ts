/**
 * Web Worker that runs bakeArt() off the main thread at page load (~110 ms of pixel work on a
 * laptop) and transfers the result: { page, w, h, textures, anims, anchors } (BakedArt).
 */
import { bakeArt } from './baked.ts';

const art = bakeArt();
globalThis.postMessage(art, { transfer: [art.page.buffer] });
