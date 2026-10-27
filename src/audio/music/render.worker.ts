/**
 * Web Worker that renders one song to PCM off the main thread.
 * Request: TrackRef. Response: { key, sampleRate, channels, final? } with every buffer transferred
 * (zero-copy), or { key, error } if rendering failed. `final` is the quarter track's final-100 mix.
 */

import { getSong, renderSong, type TrackRef } from './index.ts';

globalThis.addEventListener('message', (e: MessageEvent<TrackRef>) => {
  const ref = e.data;
  try {
    const pcm = renderSong(getSong(ref));
    const channels = pcm.channels as Float32Array<ArrayBuffer>[];
    const final = pcm.final as Float32Array<ArrayBuffer>[] | undefined;
    globalThis.postMessage(
      { key: ref.key, sampleRate: pcm.sampleRate, channels, final },
      { transfer: [...channels, ...(final ?? [])].map((c) => c.buffer) },
    );
  } catch (err) {
    globalThis.postMessage({ key: ref.key, error: String(err) });
  }
});
