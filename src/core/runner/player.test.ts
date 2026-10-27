import { describe, expect, it } from 'vitest';
import { DT_MS } from '../clock/clock.ts';
import { crossingMs, PlayerBody } from './player.ts';

describe('PlayerBody (design 2.3)', () => {
  it('adds 0.50 m/s per valid step, capped at 12.5 m/s', () => {
    const b = new PlayerBody();
    b.impulse(0, null);
    expect(b.v).toBe(0.5);
    for (let i = 0; i < 40; i++) b.impulse(0, null);
    expect(b.v).toBe(12.5);
  });

  it('applies proportional drag K = 0.5/s while mashing (no idle braking within 250 ms)', () => {
    const b = new PlayerBody();
    b.v = 10;
    b.step(0, 250, null);
    expect(b.v).toBeCloseTo(10 * (1 - 0.5 / 120), 12);
    expect(b.x).toBeCloseTo(b.v / 120, 12);
  });

  it('adds 3.0 m/s^2 idle braking after 250 ms without a step', () => {
    const b = new PlayerBody();
    b.v = 10;
    b.step(0, 251, null);
    expect(b.v).toBeCloseTo(10 * (1 - 0.5 / 120) - 3 / 120, 12);
  });

  it('idle braking never goes below zero and stops a full-speed runner within ~3 s', () => {
    const b = new PlayerBody();
    b.v = 12.5;
    let k = 0;
    while (b.v > 0 && k < 1000) b.step(k++ * DT_MS, 1000, null);
    expect(b.v).toBe(0);
    expect(k * DT_MS).toBeLessThan(3000);
  });

  it('interpolates the crossing within the tick (design 2.6)', () => {
    expect(crossingMs(1000, 99.9, 100.1, 100)).toBe(Math.round(1000 + DT_MS / 2));
    expect(crossingMs(0, 99, 100, 100)).toBe(Math.round(DT_MS));
  });

  it('never moves past the end of the run-out', () => {
    const b = new PlayerBody();
    b.x = 119.99;
    b.v = 12;
    b.step(0, 0, null);
    expect(b.x).toBe(120);
    expect(b.v).toBe(0);
  });
});
