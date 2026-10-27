/**
 * Asynchronous song rendering. Prefers a Web Worker (zero main-thread cost); falls back to rendering
 * one ZzFXM channel per macrotask on the main thread (each chunk ~10-60 ms on a laptop) when
 * workers are unavailable (Node tests) or the worker fails.
 */

import type { Pcm } from './types.ts';
import { getSong, renderSongSteps, type TrackRef } from './music/index.ts';

type Reply =
  | { key: string; sampleRate: number; channels: Float32Array[]; final?: Float32Array[] }
  | { key: string; error: string };

let worker: Worker | null = null;
let workerBroken = typeof Worker === 'undefined';
const waiting = new Map<string, { resolve: (p: Pcm) => void; reject: (e: unknown) => void }>();

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
      else {
        const { sampleRate, channels, final } = reply;
        w.resolve(final ? { sampleRate, channels, final } : { sampleRate, channels });
      }
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

/** Render a track, off-thread when possible. */
export async function renderTrack(ref: TrackRef): Promise<Pcm> {
  const w = getWorker();
  if (w) {
    try {
      return await new Promise<Pcm>((resolve, reject) => {
        waiting.set(ref.key, { resolve, reject });
        w.postMessage(ref);
      });
    } catch {
      // fall through to the main-thread renderer
    }
  }
  return renderChunked(ref);
}
