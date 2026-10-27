/**
 * Phaser glue: uploads the baked atlas (../baked.ts) and registers textures and animations
 * (research 3).
 *
 * Each texture key is still its own Phaser Texture, so callers are unchanged, but all of them
 * share the atlas's one GL texture: a frame of art never forces a texture switch, and Phaser never
 * sees a new texture count in a batch mid-game (each count compiles a new shader variant).
 *
 * The bake itself runs in a worker started by prepareBake() at page load; registerAll() bakes
 * inline when that result is not there (worker unsupported, failed or not awaited).
 */
import type Phaser from 'phaser';
import {
  bakeField,
  bakeMain,
  BOARD50_M,
  FIELD_PARTS,
  joinFieldParts,
  KEYS,
  mergeBaked,
  SPLIT_BOARD_M,
  type BakedArt,
} from '../baked.ts';
import type { Anchors } from '../chars/rig.ts';

export { BOARD50_M, KEYS, SPLIT_BOARD_M };

const anchors = new Map<string, Anchors>();

/** Overlay anchors (frame px) for a character frame, e.g. the mouth for Jess's gum bubble. */
export function frameAnchors(id: string, frame: string): Anchors | undefined {
  return anchors.get(`${id}/${frame}`);
}

/** Phaser.Textures.FilterMode.NEAREST (src/textures/const.js). */
const NEAREST = 1;

let prepared: Promise<void> | null = null;
let bakedMain: BakedArt | null = null;
let bakedField: BakedArt | null = null;

/** Runs one bake worker; resolves with its result, or null if it failed or is unsupported. */
function runWorker(create: () => Worker, message?: number): Promise<BakedArt | null> {
  return new Promise((resolve) => {
    try {
      const worker = create();
      if (message !== undefined) worker.postMessage(message);
      const done = (art: BakedArt | null): void => {
        worker.terminate();
        resolve(art);
      };
      worker.addEventListener('message', (e: MessageEvent<BakedArt>) => done(e.data));
      worker.addEventListener('error', () => done(null));
      worker.addEventListener('messageerror', () => done(null));
    } catch {
      resolve(null);
    }
  });
}

/**
 * Starts the bake workers once, in parallel: the main page and the two halves of the field page.
 * Resolves when all results arrived or failed; never rejects.
 */
export function prepareBake(): Promise<void> {
  prepared ??= (async () => {
    if (typeof Worker === 'undefined') return;
    // Literal `new Worker(new URL(...))` expressions: Vite only bundles workers written this way.
    const [main, ...parts] = await Promise.all([
      runWorker(() => new Worker(new URL('../bake.worker.ts', import.meta.url), { type: 'module' })),
      ...FIELD_PARTS.map((_, i) =>
        runWorker(() => new Worker(new URL('../field.worker.ts', import.meta.url), { type: 'module' }), i),
      ),
    ]);
    const field = parts.every((p) => p !== null) ? joinFieldParts(parts as BakedArt[]) : null;
    bakedMain ??= main;
    bakedField ??= field;
  })();
  return prepared;
}

/**
 * Uploads the pages, then registers each key as a Texture on its page's GL texture: `__BASE` covers
 * the key's rect (as a standalone texture's would) plus its named frames.
 */
function addAtlas(scene: Phaser.Scene, art: BakedArt): void {
  const gls = art.pages.map((p) => {
    const atlas = scene.textures.addUint8Array(p.key, p.data, p.w, p.h);
    const gl = atlas?.source[0]?.glTexture;
    if (!gl) throw new Error(`art: could not create the atlas texture ${p.key} (WebGL required)`);
    return gl;
  });
  // A new TextureSource in a pixel-art game calls setFilter(NEAREST), which re-uploads the whole
  // GL texture: 124 keys meant 124 uploads of the page (~340 ms). The shared texture is already
  // NEAREST (created above with antialias off), so skip that per key and record the mode instead.
  const config = scene.game.config as { antialias: boolean };
  const antialias = config.antialias;
  config.antialias = true;
  try {
    for (const t of art.textures) {
      const tex = scene.textures.addGLTexture(t.key, gls[t.page]!);
      if (!tex) throw new Error(`art: could not create texture ${t.key}`);
      tex.source[0]!.scaleMode = NEAREST;
      tex.remove('__BASE');
      tex.add('__BASE', 0, t.x, t.y, t.w, t.h);
      for (const r of t.frames) tex.add(r.name, 0, t.x + r.x, t.y + r.y, r.w, r.h);
    }
  } finally {
    config.antialias = antialias;
  }
}

export function registerAll(scene: Phaser.Scene): void {
  // Idempotent per game.
  if (scene.textures.exists(KEYS.atlas)) return;
  const art = mergeBaked(bakedMain ?? bakeMain(), bakedField ?? bakeField());
  bakedMain = null;
  bakedField = null;
  addAtlas(scene, art);
  for (const [k, a] of art.anchors) anchors.set(k, a);
  for (const a of art.anims) {
    if (scene.anims.exists(a.key)) continue;
    scene.anims.create({
      key: a.key,
      frames: a.frames.map((f) => ({ ...f })),
      frameRate: a.fps,
      repeat: a.repeat,
      ...(a.repeatDelay === undefined ? {} : { repeatDelay: a.repeatDelay }),
    });
  }
}
