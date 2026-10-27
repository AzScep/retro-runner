import { describe, expect, it } from 'vitest';
import { LATE_SFX, renderSfx, SFX } from './sfx.ts';
import { levels, SAMPLE_RATE } from './synth.ts';
import { SFX_IDS, type SfxId } from './types.ts';

/** Design 7.2, 20.1 and 36.1 lengths in seconds (flashbulb is not in 7.2; it is a short distant pop). */
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
  jump: 0.12,
  land: 0.04,
  hurdle_clip: 0.08,
  hurdle_hit: 0.3,
  split: 0.15,
  bell: 0.6,
  stamina_low: 0.12,
  stamina_empty: 0.4,
  pistol: 0.25,
  trip_thud: 0.3,
  reveal_sting_1: 0.6,
  reveal_sting_2: 1.5,
  photo_click: 0.12,
  bubble: 0.06,
  gauntlet_clear: 3.0,
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

  it('v2 SFX have burst guards that never cut the design cadence', () => {
    // Core emits staminaLow every 0.6 s and staminaEmpty at most once per 3 s (design 20.1).
    expect(SFX.stamina_low.minInterval).toBeGreaterThan(0);
    expect(SFX.stamina_low.minInterval).toBeLessThan(0.6);
    expect(SFX.stamina_empty.minInterval).toBeGreaterThan(0);
    expect(SFX.stamina_empty.minInterval).toBeLessThan(3);
    // A jump is 0.40 s of air plus a 0.10 s lock: one takeoff per lane per 0.5 s at most.
    for (const id of ['jump', 'land', 'hurdle_clip', 'hurdle_hit'] as const) {
      expect(SFX[id].minInterval).toBeGreaterThan(0);
      expect(SFX[id].minInterval).toBeLessThan(0.5);
    }
    // Splits and the bell are 100 m apart (10 s or more).
    for (const id of ['split', 'bell'] as const) {
      expect(SFX[id].minInterval).toBeGreaterThan(0);
      expect(SFX[id].minInterval).toBeLessThan(1);
    }
  });

  it('jump is a rising sweep and the bell strikes twice', () => {
    expect(SFX.jump.layers[0]!.params[8]).toBeGreaterThan(0); // positive slide
    const strikes = new Set(SFX.bell.layers.map((l) => l.at));
    expect(strikes.size).toBe(2);
  });

  it('v3: the late bank is exactly the race / reveal / Gauntlet SFX, never a menu sound', () => {
    expect([...LATE_SFX].sort()).toEqual([
      'bubble',
      'gauntlet_clear',
      'photo_click',
      'pistol',
      'reveal_sting_1',
      'reveal_sting_2',
      'trip_thud',
    ]);
    for (const id of ['menu_move', 'menu_select', 'menu_back', 'beep_count', 'beep_go'] as const) {
      expect(LATE_SFX.has(id)).toBe(false);
    }
  });

  it('v3: the pistol cracks at once and dies away within its 250 ms (layered over beep_go)', () => {
    const pcm = renderSfx('pistol');
    const ms = (a: number, b: number) =>
      levels([pcm.subarray(Math.round(a * SAMPLE_RATE), Math.round(b * SAMPLE_RATE))]).rms;
    expect(ms(0, 0.03)).toBeGreaterThan(ms(0.15, 0.25) * 4);
    expect(SFX.pistol.length).toBeLessThan(SFX.beep_go.length);
  });

  it('v3: reveal_sting_1 is a falling power-down, reveal_sting_2 swells in', () => {
    const one = renderSfx('reveal_sting_1');
    const zeroCrossings = (a: number, b: number) => {
      let z = 0;
      for (let i = Math.round(a * SAMPLE_RATE) + 1; i < Math.round(b * SAMPLE_RATE); i++) {
        if (one[i - 1]! < 0 !== one[i]! < 0) z++;
      }
      return z;
    };
    expect(zeroCrossings(0.02, 0.12)).toBeGreaterThan(zeroCrossings(0.4, 0.5) * 2);
    // Every saw / pulse voice glides down and never turns back up (frequency stays positive).
    for (const l of SFX.reveal_sting_1.layers.slice(0, 3)) {
      const [, , f, , sus, rel, , , slide, dslide] = l.params as number[];
      const t = sus! + rel!;
      expect(slide).toBeLessThan(0);
      expect(f! + 500 * (slide! * t + (dslide! * t * t) / 2)).toBeGreaterThan(0);
    }
    const two = renderSfx('reveal_sting_2');
    const rms = (a: number, b: number) =>
      levels([two.subarray(Math.round(a * SAMPLE_RATE), Math.round(b * SAMPLE_RATE))]).rms;
    expect(rms(0.6, 0.9)).toBeGreaterThan(rms(0, 0.15) * 3);
  });

  it('v3: bubble is quiet, gauntlet_clear outlasts win_jingle', () => {
    expect(levels([renderSfx('bubble')]).peak).toBeLessThan(levels([renderSfx('menu_move')]).peak);
    expect(SFX.gauntlet_clear.length).toBeGreaterThan(SFX.win_jingle.length);
  });
});
