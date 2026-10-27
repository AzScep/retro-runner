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
import { bakeArt, KEYS, type BakedArt } from '../baked.ts';
import type { Anchors } from '../chars/rig.ts';

export { KEYS };

const anchors = new Map<string, Anchors>();

/** Overlay anchors (frame px) for a character frame, e.g. the mouth for Jess's gum bubble. */
export function frameAnchors(id: string, frame: string): Anchors | undefined {
  return anchors.get(`${id}/${frame}`);
}

/** Phaser.Textures.FilterMode.NEAREST (src/textures/const.js). */
const NEAREST = 1;

let prepared: Promise<void> | null = null;
let baked: BakedArt | null = null;

/** Starts the bake worker once. Resolves when its result arrived or it failed; never rejects. */
export function prepareBake(): Promise<void> {
  prepared ??= new Promise<void>((resolve) => {
    if (typeof Worker === 'undefined') {
      resolve();
      return;
    }
    try {
      const worker = new Worker(new URL('../bake.worker.ts', import.meta.url), { type: 'module' });
      const done = (art: BakedArt | null): void => {
        baked ??= art;
        worker.terminate();
        resolve();
      };
      worker.addEventListener('message', (e: MessageEvent<BakedArt>) => done(e.data));
      worker.addEventListener('error', () => done(null));
      worker.addEventListener('messageerror', () => done(null));
    } catch {
      resolve();
    }
  });
  return prepared;
}

/**
 * Uploads the page, then registers each key as a Texture on the shared GL texture: `__BASE` covers
 * the key's rect (as a standalone texture's would) plus its named frames.
 */
function addAtlas(scene: Phaser.Scene, art: BakedArt): void {
  const atlas = scene.textures.addUint8Array(KEYS.atlas, art.page, art.w, art.h);
  const gl = atlas?.source[0]?.glTexture;
  if (!gl) throw new Error('art: could not create the atlas texture (WebGL required)');
  // A new TextureSource in a pixel-art game calls setFilter(NEAREST), which re-uploads the whole
  // GL texture: 124 keys meant 124 uploads of the page (~340 ms). The shared texture is already
  // NEAREST (created above with antialias off), so skip that per key and record the mode instead.
  const config = scene.game.config as { antialias: boolean };
  const antialias = config.antialias;
  config.antialias = true;
  try {
    for (const t of art.textures) {
      const tex = scene.textures.addGLTexture(t.key, gl);
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
  const art = baked ?? bakeArt();
  baked = null;
  addAtlas(scene, art);
  for (const [k, a] of art.anchors) anchors.set(k, a);
  for (const a of art.anims) {
    if (scene.anims.exists(a.key)) continue;
    scene.anims.create({
      key: a.key,
      frames: a.frames.map((frame) => ({ key: a.texture, frame })),
      frameRate: a.fps,
      repeat: a.repeat,
    });
  }
}
