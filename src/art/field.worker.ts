/**
 * Web Worker that bakes one part of the field page (design 35.1: 868 frames, the largest bake).
 * Two of these run in parallel with bake.worker.ts; the first message names the part (an index into
 * FIELD_PARTS) and the reply is that part's BakedArt (joined by phaser/textures.ts).
 */
import { bakeFieldPart, FIELD_PARTS } from './baked.ts';

globalThis.addEventListener('message', (e: MessageEvent<number>) => {
  const art = bakeFieldPart(FIELD_PARTS[e.data] ?? []);
  globalThis.postMessage(art, { transfer: art.pages.map((p) => p.data.buffer) });
});
