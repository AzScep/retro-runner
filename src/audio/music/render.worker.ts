/**
 * Web Worker that renders one song to PCM off the main thread.
 * Request: TrackRef. Response: { key, sampleRate, left, right } with the buffers transferred,
 * or { key, error } if rendering failed.
 */

import { getSong, renderSong, type TrackRef } from './index.ts';

globalThis.addEventListener('message', (e: MessageEvent<TrackRef>) => {
  const ref = e.data;
  try {
    const pcm = renderSong(getSong(ref));
    const [left, right] = pcm.channels as [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>];
    globalThis.postMessage(
      { key: ref.key, sampleRate: pcm.sampleRate, left, right },
      { transfer: [left.buffer, right.buffer] },
    );
  } catch (err) {
    globalThis.postMessage({ key: ref.key, error: String(err) });
  }
});
