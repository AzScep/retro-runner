import { describe, expect, it } from 'vitest';
import { CROWD_SECONDS, renderCrowdLoop } from './crowd.ts';
import { levels, SAMPLE_RATE } from './synth.ts';

describe('crowd loop', () => {
  const pcm = renderCrowdLoop();

  it('is a few seconds long, audible and not clipping', () => {
    expect(pcm.length).toBe(CROWD_SECONDS * SAMPLE_RATE);
    const { peak, rms } = levels([pcm]);
    expect(peak).toBeLessThan(1);
    expect(rms).toBeGreaterThan(0.1);
  });

  it('wraps without a discontinuity larger than its normal sample-to-sample motion', () => {
    let maxStep = 0;
    for (let i = 1; i < pcm.length; i++) maxStep = Math.max(maxStep, Math.abs(pcm[i]! - pcm[i - 1]!));
    expect(Math.abs(pcm[0]! - pcm[pcm.length - 1]!)).toBeLessThanOrEqual(maxStep);
  });

  it('is deterministic', () => {
    expect(renderCrowdLoop()).toEqual(pcm);
  });
});
