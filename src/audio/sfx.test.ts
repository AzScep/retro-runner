import { describe, expect, it } from 'vitest';
import { renderSfx, SFX } from './sfx.ts';
import { levels, SAMPLE_RATE } from './synth.ts';
import { SFX_IDS, type SfxId } from './types.ts';

/** Design 7.2 lengths in seconds (flashbulb is not in the table; it is a short distant pop). */
const DESIGN_LENGTH: Record<SfxId, number> = {
  step_l: 0.04,
  step_r: 0.04,
  fumble: 0.06,
  beep_count: 0.15,
  beep_go: 0.4,
  false_start: 0.5,
  finish: 0.8,
  win_jingle: 2.5,
  lose_jingle: 2.0,
  new_pb: 0.6,
  unlock: 0.8,
  menu_move: 0.05,
  menu_select: 0.12,
  menu_back: 0.1,
  warp: 0.3,
  overheat: 0.6,
  flashbulb: 0.25,
};

describe('sfx', () => {
  it('has a definition for every SfxId and nothing else', () => {
    expect(Object.keys(SFX).sort()).toEqual([...SFX_IDS].sort());
  });

  it.each(SFX_IDS)('%s renders at the design length, audible, not clipping, click-free edges', (id) => {
    const pcm = renderSfx(id);
    expect(pcm.length).toBe(Math.round(DESIGN_LENGTH[id] * SAMPLE_RATE));
    const { peak, rms } = levels([pcm]);
    expect(peak).toBeLessThan(1);
    expect(rms).toBeGreaterThan(0.02);
    expect(Math.abs(pcm[0]!)).toBeLessThan(0.01);
    expect(Math.abs(pcm[pcm.length - 1]!)).toBeLessThan(0.01);
    expect(pcm.every(Number.isFinite)).toBe(true);
  });

  it('renders deterministically', () => {
    expect(renderSfx('overheat')).toEqual(renderSfx('overheat'));
  });

  it('step_r is the same sound as step_l two semitones higher', () => {
    const l = SFX.step_l.layers;
    const r = SFX.step_r.layers;
    expect(r).toHaveLength(l.length);
    l.forEach((layer, i) => {
      expect(r[i]!.params[2]! / layer.params[2]!).toBeCloseTo(2 ** (2 / 12), 6);
    });
  });

  it('steps share one 40 ms rate limit', () => {
    expect(SFX.step_l.minInterval).toBe(0.04);
    expect(SFX.step_r.minInterval).toBe(0.04);
    expect(SFX.step_l.group).toBe(SFX.step_r.group);
  });

  it('countdown beeps are 440 Hz and 880 Hz squares', () => {
    expect(SFX.beep_count.layers[0]!.params[2]).toBe(440);
    expect(SFX.beep_go.layers[0]!.params[2]).toBe(880);
    expect(SFX.beep_count.layers[0]!.params[6]).toBe(5); // pulse
  });
});
