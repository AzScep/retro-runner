/**
 * Web Worker that renders audio off the main thread.
 * Requests:
 * - TrackRef: one song. Response { key, sampleRate, channels, final? }; `final` is the quarter
 *   track's final-100 mix.
 * - { key: SFX_BANK_KEY }: every SFX plus the crowd loop. Response { key, sfx, crowd }.
 * Every buffer is transferred (zero-copy); a failure answers { key, error }.
 */

import { renderCrowdLoop } from '../crowd.ts';
import { renderSfx } from '../sfx.ts';
import { SFX_IDS } from '../types.ts';
import { getSong, renderSong, SFX_BANK_KEY, type TrackRef } from './index.ts';

globalThis.addEventListener('message', (e: MessageEvent<TrackRef | { key: typeof SFX_BANK_KEY }>) => {
  const req = e.data;
  try {
    if (req.key === SFX_BANK_KEY) {
      const sfx: Record<string, Float32Array<ArrayBuffer>> = {};
      for (const id of SFX_IDS) sfx[id] = renderSfx(id) as Float32Array<ArrayBuffer>;
      const crowd = renderCrowdLoop() as Float32Array<ArrayBuffer>;
      globalThis.postMessage(
        { key: req.key, sfx, crowd },
        { transfer: [...Object.values(sfx).map((a) => a.buffer), crowd.buffer] },
      );
      return;
    }
    const ref = req as TrackRef;
    const pcm = renderSong(getSong(ref));
    const channels = pcm.channels as Float32Array<ArrayBuffer>[];
    const final = pcm.final as Float32Array<ArrayBuffer>[] | undefined;
    globalThis.postMessage(
      { key: ref.key, sampleRate: pcm.sampleRate, channels, final },
      { transfer: [...channels, ...(final ?? [])].map((c) => c.buffer) },
    );
  } catch (err) {
    globalThis.postMessage({ key: req.key, error: String(err) });
  }
});
