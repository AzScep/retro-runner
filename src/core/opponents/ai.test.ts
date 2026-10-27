import { describe, expect, it } from 'vitest';
import type { OpponentId, RaceEvent, RunnerEffect } from '../index.ts';
import { DT_MS } from '../clock/clock.ts';
import { mulberry32 } from '../rng/mulberry32.ts';
import { rivalSpec } from './specs.ts';
import { planRival, RivalSim, type RivalPlan } from './ai.ts';

interface Sample {
  readonly k: number;
  readonly x: number;
  readonly v: number;
  readonly effect: RunnerEffect;
  readonly visible: boolean;
  readonly tripping: boolean;
}

/** Run a rival alone (or against a player at constant speed) and record every tick. */
function run(
  id: OpponentId,
  plan?: RivalPlan,
  playerSpeed: number | null = null,
): { events: RaceEvent[]; samples: Sample[]; sim: RivalSim } {
  const sim = new RivalSim('100m', id, plan ?? planRival('100m', id, mulberry32(42)));
  const events: RaceEvent[] = [];
  const samples: Sample[] = [];
  for (let k = 0; k < 3600; k++) {
    const t0 = k * DT_MS;
    const playerX = playerSpeed === null ? null : Math.min(120, (playerSpeed * t0) / 1000);
    sim.step(t0, playerX, events);
    samples.push({
      k,
      x: sim.x,
      v: sim.v,
      effect: sim.effect,
      visible: sim.visible,
      tripping: sim.tripping,
    });
  }
  return { events, samples, sim };
}

const quirks = (events: RaceEvent[]): string[] => events.flatMap((e) => (e.type === 'quirk' ? [e.name] : []));

/** Unshifted plan with an exact V_TOP, for checking quirk geometry. */
const exact = (vTop: number, at: number[]): RivalPlan => ({ vTop, at, hurdles: [] });

describe('RivalSim (design 3.1)', () => {
  it('does not move before its reaction time, then approaches V_TOP exponentially', () => {
    const sim = new RivalSim('100m', 'kofi', exact(9, [200]));
    sim.step(0, null, null);
    sim.step(170, null, null);
    expect(sim.v).toBe(0);
    sim.step(180, null, null);
    expect(sim.v).toBeCloseTo(9 * (1 / 120 / 1.4), 12);
  });

  it('per-race variance stays inside +/-1% V_TOP and +/-3 m triggers, and is seed-deterministic', () => {
    for (let seed = 1; seed < 200; seed++) {
      const plan = planRival('100m', 'unit7', mulberry32(seed));
      const base = rivalSpec('100m', 'unit7').vTop;
      expect(plan.vTop / base).toBeGreaterThanOrEqual(0.99);
      expect(plan.vTop / base).toBeLessThanOrEqual(1.01);
      expect(Math.abs((plan.at[0] ?? 0) - 50)).toBeLessThanOrEqual(3);
      expect(Math.abs((plan.at[1] ?? 0) - 85)).toBeLessThanOrEqual(3);
    }
    expect(planRival('100m', 'zyx', mulberry32(9))).toEqual(planRival('100m', 'zyx', mulberry32(9)));
    expect(planRival('100m', 'zyx', mulberry32(9))).not.toEqual(planRival('100m', 'zyx', mulberry32(10)));
  });

  it('crosses with the interpolated finish rule and stops inside the run-out', () => {
    const { sim, events } = run('unit7');
    const finish = events.find((e) => e.type === 'rivalFinish');
    expect(finish?.type === 'rivalFinish' && finish.ms).toBe(sim.finishMs);
    expect(sim.x).toBeLessThanOrEqual(120);
    expect(sim.v).toBe(0);
  });
});

describe('quirks (design 3.3)', () => {
  it('Pip trips at 45 m (x0.30 for 0.6 s, stumble) and waves at 80 m (x0.85 for 1.0 s)', () => {
    const { events, samples } = run('pip', exact(6.4, [45, 80]));
    expect(quirks(events)).toEqual(['trip', 'wave']);
    const trip = samples.filter((s) => s.tripping);
    expect(trip.length).toBe(72);
    expect(trip[0]?.x).toBeGreaterThanOrEqual(45);
    const tripEnd = trip[trip.length - 1];
    // tau 1.5 s: 0.6 s toward 0.30 x V_TOP leaves ~77% of V_TOP.
    expect(tripEnd?.v).toBeLessThan(6.4 * 0.8);
    const wave = samples.filter((s) => s.effect === 'wave');
    expect(wave.length).toBe(120);
    expect(wave[0]?.x).toBeGreaterThanOrEqual(80);
  });

  it('Jess fades from 60 m', () => {
    const { events, samples } = run('jess', exact(7.6, [60]));
    expect(quirks(events)).toEqual(['fade']);
    const at95 = samples.find((s) => s.x >= 95);
    expect(at95?.v).toBeCloseTo(7.6 * 0.9, 1);
  });

  it('Marco coasts 30-50 m at x0.93', () => {
    const { events, samples } = run('marco', exact(8.75, [30]));
    expect(quirks(events)).toEqual(['coast']);
    const at49 = samples.find((s) => s.x >= 49.5);
    expect(at49?.v).toBeLessThan(8.75 * 0.96);
    const at90 = samples.find((s) => s.x >= 90);
    expect(at90?.v).toBeGreaterThan(8.75 * 0.99);
  });

  it('Kofi kicks from 80 m at x1.05', () => {
    const { events, samples } = run('kofi', exact(9, [80]));
    expect(quirks(events)).toEqual(['kick']);
    const at99 = samples.find((s) => s.x >= 99);
    expect(at99?.v).toBeGreaterThan(9 * 1.03);
  });

  it('Valentina kicks from 70 m and pops the flashbulb there', () => {
    const { events, samples } = run('valentina', exact(9.6, [70]));
    expect(quirks(events)).toEqual(['kick', 'flashbulb']);
    expect(samples.find((s) => s.x >= 99)?.v).toBeGreaterThan(9.6 * 1.025);
  });

  it('UNIT-7 overclocks 50-85 m (red glow) then overheats 85-92 m (sparks)', () => {
    const { events, samples } = run('unit7', exact(11.6, [50, 85]));
    expect(quirks(events)).toEqual(['overclock', 'overheat']);
    expect(samples.find((s) => s.x >= 60)?.effect).toBe('overclock');
    expect(samples.find((s) => s.x >= 88)?.effect).toBe('overheat');
    expect(samples.find((s) => s.x >= 93)?.effect).toBe('none');
    const v84 = samples.find((s) => s.x >= 84.5)?.v ?? 0;
    const v91 = samples.find((s) => s.x >= 91.5)?.v ?? 0;
    // tau 2.4 s makes the 0.80 target bite gently over 7 m.
    expect(v91).toBeLessThan(v84 * 0.97);
  });

  it('Zyx warps at 30 m and 65 m: invisible 0.25 s, no movement, reappears 5 m ahead at the same speed', () => {
    const { events, samples } = run('zyx', exact(10.2, [30, 65, 50]));
    expect(quirks(events)).toEqual(['warpOut', 'warpIn', 'warpOut', 'warpIn']);
    const hidden = samples.filter((s) => !s.visible);
    expect(hidden.length).toBe(2 * 30); // 2 warps x 0.25 s x 120 Hz
    const firstHidden = samples.findIndex((s) => !s.visible);
    // Sample firstHidden is the tick that reached 30 m; the next 30 ticks hold still, the last jumps.
    const before = samples[firstHidden] as Sample;
    expect(samples[firstHidden + 29]?.x).toBe(before.x);
    const after = samples[firstHidden + 30] as Sample;
    expect(after.visible).toBe(true);
    expect(after.x - before.x).toBeCloseTo(5, 9);
    expect(after.v).toBe(before.v);
    expect(after.effect).toBe('warpIn');
  });

  it('Zyx pressure: after 50 m, a player leading by more than 1.5 m triggers x1.03', () => {
    const calm = run('zyx', exact(10.2, [30, 65, 50]));
    const pressed = run('zyx', exact(10.2, [30, 65, 50]), 12.5);
    expect(quirks(calm.events)).not.toContain('pressure');
    expect(quirks(pressed.events)).toContain('pressure');
    expect(pressed.sim.finishMs ?? 0).toBeLessThan(calm.sim.finishMs ?? 0);
  });

  it('Zyx pressure does not trigger when the player is behind', () => {
    const { events } = run('zyx', exact(10.2, [30, 65, 50]), 8);
    expect(quirks(events)).not.toContain('pressure');
  });
});
