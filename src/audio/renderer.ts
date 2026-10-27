/**
 * Asynchronous audio rendering. Prefers a Web Worker (zero main-thread cost); falls back to the
 * main thread in small macrotasks (one ZzFXM channel or one SFX each, ~1-60 ms on a laptop) when
 * workers are unavailable (Node tests) or the worker fails.
 */

import type { Pcm, SfxId } from './types.ts';
import { SFX_IDS } from './types.ts';
import { getSong, renderSongSteps, SFX_BANK_KEY, type TrackRef } from './music/index.ts';
import { renderSfx } from './sfx.ts';
import { renderCrowdLoop } from './crowd.ts';

/** Every SFX plus the crowd loop, mono PCM at SAMPLE_RATE. */
export interface SfxBank {
  readonly sfx: ReadonlyMap<SfxId, Float32Array>;
  readonly crowd: Float32Array;
}

type Reply =
  | { key: string; sampleRate: number; channels: Float32Array[]; final?: Float32Array[] }
  | { key: string; sfx: Record<string, Float32Array>; crowd: Float32Array }
  | { key: string; error: string };

let worker: Worker | null = null;
let workerBroken = typeof Worker === 'undefined';
const waiting = new Map<string, { resolve: (r: Reply) => void; reject: (e: unknown) => void }>();

function failWorker(reason: unknown): void {
  workerBroken = true;
  worker?.terminate();
  worker = null;
  for (const w of waiting.values()) w.reject(reason);
  waiting.clear();
}

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (!worker) {
    try {
      worker = new Worker(new URL('./music/render.worker.ts', import.meta.url), { type: 'module' });
    } catch (err) {
      failWorker(err);
      return null;
    }
    worker.addEventListener('message', (e: MessageEvent<Reply>) => {
      const reply = e.data;
      const w = waiting.get(reply.key);
      if (!w) return;
      waiting.delete(reply.key);
      if ('error' in reply) w.reject(new Error(reply.error));
      else w.resolve(reply);
    });
    worker.addEventListener('error', (e) => failWorker(e));
  }
  return worker;
}

function yieldToMain(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

/** Render on the main thread, one channel per macrotask. */
export async function renderChunked(ref: TrackRef): Promise<Pcm> {
  const it = renderSongSteps(getSong(ref));
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
    await yieldToMain();
  }
}

/** Sends one request to the worker; rejects if there is none or it fails. */
function ask(req: TrackRef | { key: typeof SFX_BANK_KEY }): Promise<Reply> {
  const w = getWorker();
  if (!w) return Promise.reject(new Error('no worker'));
  return new Promise<Reply>((resolve, reject) => {
    waiting.set(req.key, { resolve, reject });
    w.postMessage(req);
  });
}

/** Render a track, off-thread when possible. */
export async function renderTrack(ref: TrackRef): Promise<Pcm> {
  try {
    const r = await ask(ref);
    if ('channels' in r) {
      const { sampleRate, channels, final } = r;
      return final ? { sampleRate, channels, final } : { sampleRate, channels };
    }
  } catch {
    // fall through to the main-thread renderer
  }
  return renderChunked(ref);
}

/** Render every SFX and the crowd loop, off-thread when possible (~110 ms of synthesis). */
export async function renderSfxBank(): Promise<SfxBank> {
  try {
    const r = await ask({ key: SFX_BANK_KEY });
    if ('sfx' in r) {
      const sfx = new Map<SfxId, Float32Array>();
      for (const id of SFX_IDS) {
        const pcm = r.sfx[id];
        if (!pcm) throw new Error(`worker sent no ${id}`);
        sfx.set(id, pcm);
      }
      return { sfx, crowd: r.crowd };
    }
  } catch {
    // fall through to the main-thread renderer
  }
  const sfx = new Map<SfxId, Float32Array>();
  for (const id of SFX_IDS) {
    sfx.set(id, renderSfx(id));
    await yieldToMain();
  }
  return { sfx, crowd: renderCrowdLoop() };
}
