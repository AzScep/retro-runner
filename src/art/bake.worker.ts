/**
 * Web Worker that runs bakeMain() off the main thread at page load and transfers the result
 * (BakedArt with page 0). The field page bakes in parallel in field.worker.ts.
 */
import { bakeMain } from './baked.ts';

const art = bakeMain();
globalThis.postMessage(art, { transfer: art.pages.map((p) => p.data.buffer) });
