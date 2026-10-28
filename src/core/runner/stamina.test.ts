import { describe, expect, it } from 'vitest';
import type { RaceEvent } from '../index.ts';
import { DT_MS } from '../clock/clock.ts';
import { PlayerBody, staminaCap } from './player.ts';

// Design 14.1 at the body level.

const DT = 1 / 120;

describe('stamina cap (design 14.1)', () => {
  it('is V_MAX at or above S_FATIGUE and falls linearly to V_TIRED at 0', () => {
    expect(staminaCap(1)).toBe(12.5);
    expect(staminaCap(0.3)).toBe(12.5);
    expect(staminaCap(0.15)).toBeCloseTo(9.25, 12);
    expect(staminaCap(0)).toBe(6);
  });
});

describe('valid step in the 400 m (design 14.1)', () => {
  it('costs 0.014 before the impulse and adds J up to the cap', () => {
    const b = new PlayerBody('400m');
    expect(b.stamina).toBe(1);
    b.impulse(0, null);
    expect(b.stamina).toBeCloseTo(0.986, 12);
    expect(b.v).toBe(0.5);
  });

  it('the cap uses the stamina after the cost; the impulse stops at the cap', () => {
    const b = new PlayerBody('400m');
    b.stamina = 0.164; // 0.150 after the cost: cap 9.25
    b.v = 9.2;
    b.impulse(0, null);
    expect(b.stamina).toBeCloseTo(0.15, 12);
    expect(b.v).toBeCloseTo(9.25, 12);
  });

  it('a step at or above the cap still costs stamina but adds nothing', () => {
    const b = new PlayerBody('400m');
    b.stamina = 0.1;
    b.v = 9;
    b.impulse(0, null);
    expect(b.stamina).toBeCloseTo(0.086, 12);
    expect(b.v).toBe(9);
  });

  it('never goes below 0', () => {
    const b = new PlayerBody('400m');
    b.stamina = 0.005;
    b.impulse(0, null);
    expect(b.stamina).toBe(0);
  });

  it('100 m and hurdles have no stamina', () => {
    expect(new PlayerBody('100m').stamina).toBeNull();
    expect(new PlayerBody('110mh').stamina).toBeNull();
  });
});

describe('per tick, in order: regen, drag, fatigue decel, idle braking, move (design 14.1)', () => {
  it('regenerates 0.098/s, capped at 1', () => {
    const b = new PlayerBody('400m');
    b.stamina = 0.5;
    for (let k = 0; k < 120; k++) b.step(k * DT_MS, 0, null);
    expect(b.stamina).toBeCloseTo(0.598, 9);
    b.stamina = 0.9999;
    b.step(0, 0, null);
    expect(b.stamina).toBe(1);
  });

  it('above a falling cap, speed decays toward it at 2 m/s^2 after drag (no snapping)', () => {
    const b = new PlayerBody('400m');
    b.stamina = 0.06;
    b.v = 12;
    b.step(0, 0, null);
    const s = 0.06 + 0.098 * DT; // regen comes first, so the cap uses it
    const cap = 6 + (6.5 * s) / 0.3;
    const expected = Math.max(cap, 12 * (1 - 0.5 * DT) - 2 * DT);
    expect(b.stamina).toBeCloseTo(s, 12);
    expect(b.v).toBeCloseTo(expected, 12);
    expect(b.x).toBeCloseTo(expected * DT, 12);
  });

  it('stops the fatigue decay at the cap, and idle braking still applies after it', () => {
    const b = new PlayerBody('400m');
    b.stamina = 0;
    b.v = 6.05;
    b.step(0, 0, null);
    const cap = 6 + (6.5 * 0.098 * DT) / 0.3;
    expect(b.v).toBeCloseTo(Math.max(cap, 6.05 * (1 - 0.5 * DT) - 2 * DT), 12);
    expect(b.v).toBe(cap);
    const c = new PlayerBody('400m');
    c.stamina = 0;
    c.v = 6.05;
    c.step(0, 1000, null);
    expect(c.v).toBeCloseTo(cap - 3 * DT, 12);
  });
});

describe('stamina events (design 14.1, 20.1)', () => {
  it('staminaLow fires on dropping below 0.30 and then every 0.6 s while below', () => {
    const b = new PlayerBody('400m');
    b.stamina = 0.2;
    const ticks: number[] = [];
    for (let k = 0; k < 200; k++) {
      const log: RaceEvent[] = [];
      b.step(k * DT_MS, 0, log);
      b.stamina = 0.2; // hold it low
      if (log.some((e) => e.type === 'staminaLow')) ticks.push(k);
    }
    expect(ticks).toEqual([0, 72, 144]);
    // Back above the threshold resets the cadence: the next drop fires at once.
    b.stamina = 0.5;
    b.step(0, 0, null);
    b.stamina = 0.2;
    const log: RaceEvent[] = [];
    b.step(0, 0, log);
    expect(log).toContainEqual({ type: 'staminaLow' });
  });

  it('staminaEmpty fires when a step reaches 0, at most once per 3 s', () => {
    const b = new PlayerBody('400m');
    const at: number[] = [];
    for (let ms = 0; ms < 7000; ms += 100) {
      b.stamina = 0.01; // every step reaches 0
      const log: RaceEvent[] = [];
      b.impulse(ms, log);
      if (log.some((e) => e.type === 'staminaEmpty')) at.push(ms);
    }
    expect(at).toEqual([0, 3000, 6000]);
  });

  it('a step at exactly 0 does not "reach" 0 again', () => {
    const b = new PlayerBody('400m');
    b.stamina = 0;
    const log: RaceEvent[] = [];
    b.impulse(0, log);
    expect(log).toEqual([]);
  });
});

describe('stamina empty point (results EMPTY AT <m>M)', () => {
  it('records the whole metre where a step first reaches 0, and keeps it', () => {
    const b = new PlayerBody('400m');
    expect(b.emptyAtM).toBeNull();
    b.x = 137.6;
    b.stamina = 0.01;
    b.impulse(0, null);
    expect(b.emptyAtM).toBe(138);
    b.x = 250;
    b.stamina = 0.01;
    b.impulse(5000, null);
    expect(b.emptyAtM).toBe(138);
    expect(b.clone().emptyAtM).toBe(138);
  });

  it('stays null outside the 400 m', () => {
    const b = new PlayerBody('100m');
    b.impulse(0, null);
    expect(b.emptyAtM).toBeNull();
  });
});
