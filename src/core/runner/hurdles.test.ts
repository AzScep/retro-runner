import { describe, expect, it } from 'vitest';
import type { RaceEvent } from '../index.ts';
import { DT_MS } from '../clock/clock.ts';
import { hurdlePositions } from '../events.ts';
import { arcHeight, hurdleOutcome, PlayerBody } from './player.ts';

// Design 13.2 at the body level: exact positions and speeds, no input timing in the way.

const H1 = hurdlePositions('110mh')[0] as number;
const kinds = (log: RaceEvent[]): string[] => log.map((e) => e.type);

/** A runner at speed v who takes off `beforeS` seconds before H1 (speed is frozen in the air). */
function takeoff(beforeS: number, v = 10): { b: PlayerBody; log: RaceEvent[] } {
  const b = new PlayerBody('110mh');
  b.v = v;
  b.x = H1 - v * beforeS;
  b.xPrev = b.x;
  b.jump();
  const log: RaceEvent[] = [];
  for (let k = 0; k < 120 && b.nextHurdle === 0; k++) b.step(k * DT_MS, 0, log);
  return { b, log };
}

describe('hurdles course (design 13.1)', () => {
  it('has 10 hurdles from 13.72 m every 9.14 m, 14.02 m before the 110 m line', () => {
    expect(hurdlePositions('110mh')).toEqual([
      13.72, 22.86, 32, 41.14, 50.28, 59.42, 68.56, 77.7, 86.84, 95.98,
    ]);
    expect(110 - (hurdlePositions('110mh')[9] ?? 0)).toBeCloseTo(14.02, 9);
    expect(hurdlePositions('100m')).toEqual([]);
    expect(hurdlePositions('400m')).toEqual([]);
  });
});

describe('jump arc (design 13.2)', () => {
  it('peaks at 1.30 m half way and clears the 1.00 m bar for s in [0.260, 0.740]', () => {
    expect(arcHeight(0)).toBe(0);
    expect(arcHeight(0.5)).toBeCloseTo(1.3, 12);
    expect(arcHeight(1)).toBe(0);
    expect(arcHeight(0.26)).toBeGreaterThanOrEqual(1);
    expect(arcHeight(0.259)).toBeLessThan(1);
    expect(arcHeight(0.74)).toBeGreaterThanOrEqual(1);
    expect(arcHeight(0.741)).toBeLessThan(1);
  });

  it('classifies the crossing by the arc phase interpolated inside the tick', () => {
    // 12 ticks done (s = 0.25) and the bar is 1/4 of the way through the 13th: s = 12.25/48.
    expect(hurdleOutcome(12, 0, 4, 1)).toBe('clip');
    // 12.5/48 = 0.2604: clean.
    expect(hurdleOutcome(12, 0, 4, 2)).toBe('clean');
    expect(hurdleOutcome(null, 0, 4, 2)).toBe('hit');
  });
});

describe('takeoff window (design 13.2, edges 0.296 / 0.104 s)', () => {
  it.each([
    [0.2, 'hurdleClear'],
    [0.104, 'hurdleClear'],
    [0.296, 'hurdleClear'],
    [0.1035, 'hurdleClip'], // too late: still rising
    [0.05, 'hurdleClip'],
    [0.2965, 'hurdleClip'], // a bit early: already falling
    [0.39, 'hurdleClip'],
    [0.41, 'hurdleHit'], // landed before the hurdle
  ])('takeoff %s s before the hurdle: %s', (beforeS, kind) => {
    const { log } = takeoff(beforeS);
    expect(kinds(log).filter((k) => k.startsWith('hurdle'))).toEqual([kind]);
  });

  it('the same window in seconds holds at any speed (speed is frozen in the air)', () => {
    for (const v of [5, 8, 12.5]) {
      expect(kinds(takeoff(0.104, v).log)).toContain('hurdleClear');
      expect(kinds(takeoff(0.1035, v).log)).toContain('hurdleClip');
    }
  });
});

describe('airborne physics and outcomes (design 13.2)', () => {
  it('in the air: no drag, no idle braking; landing keeps 0.94 and locks jumps for 0.10 s', () => {
    const b = new PlayerBody('110mh');
    b.v = 10;
    b.jump();
    const log: RaceEvent[] = [];
    for (let k = 0; k < 47; k++) {
      b.step(k * DT_MS, 5000, log); // long idle: braking would apply on the ground
      expect(b.v).toBe(10);
      expect(b.canJump()).toBe(false);
    }
    expect(b.airborne).toBe(true);
    b.step(47 * DT_MS, 0, log);
    expect(b.airborne).toBe(false);
    expect(kinds(log)).toEqual(['land']);
    expect(b.v).toBeCloseTo(9.4, 12);
    expect(b.x).toBeCloseTo(4, 9); // 0.40 s at 10 m/s
    // Lock: 12 ticks (0.10 s) without jumps; running is unaffected.
    for (let k = 0; k < 12; k++) {
      expect(b.canJump()).toBe(false);
      expect(b.impulse(0, null)).toBe(true);
      b.step((48 + k) * DT_MS, 0, null);
    }
    expect(b.canJump()).toBe(true);
  });

  it('steps in the air give no impulse', () => {
    const b = new PlayerBody('110mh');
    b.v = 8;
    b.jump();
    b.step(0, 0, null);
    expect(b.impulse(10, null)).toBe(false);
    expect(b.v).toBe(8);
  });

  it('CLEAN costs only the landing; CLIP keeps 0.80 and knocks the hurdle', () => {
    const clean = takeoff(0.2);
    expect(clean.b.v).toBe(10);
    expect(clean.b.knocked[0]).toBe(false);
    const clip = takeoff(0.05);
    expect(clip.b.v).toBeCloseTo(8, 12);
    expect(clip.b.knocked[0]).toBe(true);
    expect(clip.b.hit).toBe(1);
  });

  it('HIT keeps 0.40, knocks the hurdle and stumbles 0.30 s: no impulse, no idle braking, drag only', () => {
    const b = new PlayerBody('110mh');
    b.v = 10;
    b.x = H1 - 0.05;
    const log: RaceEvent[] = [];
    b.step(0, 0, log);
    expect(kinds(log)).toEqual(['hurdleHit']);
    expect(b.v).toBeCloseTo(10 * (1 - 0.5 / 120) * 0.4, 12);
    expect(b.knocked[0]).toBe(true);
    for (let k = 1; k <= 36; k++) {
      expect(b.stumbleTicks).toBeGreaterThan(0);
      expect(b.canJump()).toBe(false);
      expect(b.impulse(0, null)).toBe(false);
      const v0 = b.v;
      b.step(k * DT_MS, 5000, null);
      expect(b.v).toBeCloseTo(v0 * (1 - 0.5 / 120), 12); // drag, no idle braking
    }
    expect(b.stumbleTicks).toBe(0);
    expect(b.canJump()).toBe(true);
    expect(b.impulse(0, null)).toBe(true);
  });

  it('no jump at all knocks every hurdle', () => {
    const b = new PlayerBody('110mh');
    for (let k = 0; k < 4000 && b.finishMs === null; k++) {
      if (k % 12 === 0) b.impulse(k * DT_MS, null);
      b.step(k * DT_MS, 0, null);
    }
    expect(b.knocked).toEqual(Array.from({ length: 10 }, () => true));
    expect(b.hit).toBe(10);
  });

  it('jumps exist only in the hurdles', () => {
    expect(new PlayerBody('100m').canJump()).toBe(false);
    expect(new PlayerBody('400m').canJump()).toBe(false);
    expect(new PlayerBody('110mh').canJump()).toBe(true);
  });
});

describe('player knock timing (in-race EARLY / LATE / TOO EARLY / JUMP!)', () => {
  const knock = (log: RaceEvent[]): RaceEvent | undefined =>
    log.find((e) => e.type === 'hurdleClip' || e.type === 'hurdleHit');

  it.each([
    [0.1035, 'hurdleClip', 'late'], // still rising at the bar
    [0.05, 'hurdleClip', 'late'],
    [0.2965, 'hurdleClip', 'early'], // already falling at the bar
    [0.39, 'hurdleClip', 'early'],
    [0.41, 'hurdleHit', 'early'], // landed before the hurdle
  ])('takeoff %s s before the hurdle: %s, %s', (beforeS, type, timing) => {
    expect(knock(takeoff(beforeS).log)).toMatchObject({ type, timing });
  });

  it('a HIT with no jump since the last hurdle carries no timing', () => {
    const b = new PlayerBody('110mh');
    b.v = 10;
    b.x = H1 - 0.05;
    const log: RaceEvent[] = [];
    b.step(0, 0, log);
    expect(knock(log)).toEqual({ type: 'hurdleHit', lane: 0, index: 0 });
  });
});
