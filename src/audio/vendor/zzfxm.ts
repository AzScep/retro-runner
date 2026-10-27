/**
 * ZzFX Music Renderer v2.0.3 by Keith Clark and Frank Force
 * https://github.com/keithclark/ZzFXM
 *
 * MIT License
 *
 * Copyright (c) 2020 Keith Clark
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

/*
  Retro Runner vendoring notes (not part of upstream):
  - Typed TypeScript port of zzfxm.js v2.0.3
    (https://raw.githubusercontent.com/keithclark/ZzFXM/master/zzfxm.js).
  - The globals `zzfxG` and `zzfxR` became the vendored zzfxBuildSamples and a `sampleRate` argument;
    instruments are rendered without frequency randomness (deterministic songs).
  - Output buffers are preallocated Float32Arrays of the song length instead of growing arrays.
    Reads of unset slots behave like upstream's `|| 0`. The render loop is otherwise unchanged.
*/

import { zzfxBuildSamples, ZZFX_SAMPLE_RATE, type ZzfxParams } from './zzfx.ts';

/** [instrument, panning (-1..1), ...notes]. Note 12 = instrument frequency; fraction = attenuation; <0 stops. */
export type ZzfxmChannel = readonly number[];
export type ZzfxmPattern = readonly ZzfxmChannel[];

/** Length in samples of one pattern row, exactly as upstream computes it. */
export function zzfxmRowLength(BPM: number, sampleRate: number = ZZFX_SAMPLE_RATE): number {
  return ((sampleRate / BPM) * 60) >> 2;
}

/** Total song length in samples (sum of first-channel rows times row length). */
export function zzfxmSongLength(
  patterns: readonly ZzfxmPattern[],
  sequence: readonly number[],
  BPM = 125,
  sampleRate: number = ZZFX_SAMPLE_RATE,
): number {
  let rows = 0;
  for (const p of sequence) rows += patterns[p]![0]!.length - 2;
  return rows * zzfxmRowLength(BPM, sampleRate);
}

/**
 * Generate a song
 *
 * @param instruments - Array of ZzFX sound paramaters.
 * @param patterns - Array of pattern data.
 * @param sequence - Array of pattern indexes.
 * @param BPM - Playback speed of the song (in BPM).
 * @returns Left and right channel sample data.
 */
export function zzfxM(
  instruments: readonly ZzfxParams[],
  patterns: readonly ZzfxmPattern[],
  sequence: readonly number[],
  BPM = 125,
  sampleRate: number = ZZFX_SAMPLE_RATE,
): [Float32Array, Float32Array] {
  let instrumentParameters: (number | undefined)[];
  let i: number;
  let j: number;
  let k: number;
  let note: number;
  let sample: number;
  let patternChannel: ZzfxmChannel;
  let notFirstBeat: number;
  let stop: number | boolean;
  let instrument: number | undefined;
  let attenuation = NaN; // upstream starts `undefined`, which behaves as NaN in arithmetic
  let outSampleOffset: number;
  let isSequenceEnd: number;
  let sampleOffset = 0;
  let nextSampleOffset: number;
  let sampleBuffer: ArrayLike<number> = [];
  const songLength = zzfxmSongLength(patterns, sequence, BPM, sampleRate);
  const leftChannelBuffer = new Float32Array(songLength);
  const rightChannelBuffer = new Float32Array(songLength);
  let channelIndex = 0;
  let panning = 0;
  let hasMore = 1;
  const sampleCache = new Map<string, ArrayLike<number>>();
  const beatLength = zzfxmRowLength(BPM, sampleRate);

  // for each channel in order until there are no more
  for (; hasMore; channelIndex++) {
    // reset current values
    sampleBuffer = [(hasMore = notFirstBeat = outSampleOffset = 0)];

    // for each pattern in sequence
    sequence.forEach((patternIndex, sequenceIndex) => {
      const pattern = patterns[patternIndex]!;
      // get pattern for current channel, use empty 1 note pattern if none found
      patternChannel = pattern[channelIndex] || [0, 0, 0];

      // check if there are more channels
      hasMore |= +!!pattern[channelIndex];

      // get next offset, use the length of first channel
      nextSampleOffset = outSampleOffset + (pattern[0]!.length - 2 - (notFirstBeat ? 0 : 1)) * beatLength;
      // for each beat in pattern, plus one extra if end of sequence
      isSequenceEnd = +(sequenceIndex == sequence.length - 1);
      for (i = 2, k = outSampleOffset; i < patternChannel.length + isSequenceEnd; notFirstBeat = ++i) {
        // <channel-note>
        note = patternChannel[i] as number;

        // stop if end, different instrument or new note
        stop =
          (i == patternChannel.length + isSequenceEnd - 1 && isSequenceEnd) ||
          (+(instrument != (patternChannel[0] || 0)) | note | 0);

        // fill buffer with samples for previous beat, most cpu intensive part
        for (
          j = 0;
          j < beatLength && notFirstBeat;
          // fade off attenuation at end of beat if stopping note, prevents clicking
          j++ > beatLength - 99 && stop ? (attenuation += +(attenuation < 1) / 99) : 0
        ) {
          // copy sample to stereo buffers with panning
          sample = ((1 - attenuation) * (sampleBuffer[sampleOffset++] as number)) / 2 || 0;
          leftChannelBuffer[k] = (leftChannelBuffer[k] || 0) - sample * panning + sample;
          rightChannelBuffer[k] = (rightChannelBuffer[k++] || 0) + sample * panning + sample;
        }

        // set up for next note
        if (note) {
          // set attenuation
          attenuation = note % 1;
          panning = patternChannel[1] || 0;
          if ((note |= 0)) {
            // get cached sample
            instrument = patternChannel[(sampleOffset = 0)] || 0;
            const key = instrument + ',' + note;
            let cached = sampleCache.get(key);
            if (!cached) {
              // add sample to cache
              instrumentParameters = [...instruments[instrument]!];
              instrumentParameters[2] = (instrumentParameters[2] as number) * 2 ** ((note - 12) / 12);

              // allow negative values to stop notes
              cached = note > 0 ? zzfxBuildSamples(instrumentParameters, sampleRate, () => 0.5) : [];
              sampleCache.set(key, cached);
            }
            sampleBuffer = cached;
          }
        }
      }

      // update the sample offset
      outSampleOffset = nextSampleOffset;
    });
  }

  return [leftChannelBuffer, rightChannelBuffer];
}
