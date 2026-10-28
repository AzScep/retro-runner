import { describe, expect, it } from 'vitest';
import type { RaceEvent, RaceInput, RunKeyEvent } from '../index.ts';
import { DT_MS } from '../clock/clock.ts';
import { alternate, down, drive, play, runToGo, startRace, START_T, up } from './testkit.ts';
import { Race } from './race.ts';

// Design 14 in the full race loop.

const count = (log: RaceEvent[], type: string): number => log.filter((e) => e.type === type).length;

/** Independent reference of design 14.1 + 2.6 for valid alternations at the given race ms. */
function reference400(pressMs: readonly number[]): { finish: number; splits: number[] } {
  let v = 0;
  let x = 0;
  let s = 1;
  let last: number | null = null;
  let i = 0;
  const splits: number[] = [];
  const cap = (st: number): number => (st >= 0.3 ? 12.5 : 6 + (6.5 * st) / 0.3);
  for (let k = 0; k < 12000; k++) {
    const t0 = k * DT_MS;
    while (i < pressMs.length && Math.ceil((pressMs[i] as number) / DT_MS - 1e-9) <= k) {
      s = Math.max(0, s - 0.014);
      if (v < cap(s)) v = Math.min(v + 0.5, cap(s));
      last = pressMs[i] as number;
      i++;
    }
    s = Math.min(1, s + 0.098 / 120);
    v -= (0.5 * v) / 120;
    if (v > cap(s)) v = Math.max(cap(s), v - 2 / 120);
    if (t0 - (last ?? 0) > 250) v = Math.max(0, v - 3 / 120);
    const xp = x;
    x += v / 120;
    for (const d of [100, 200, 300]) {
      if (xp < d && d <= x) splits.push(Math.round(t0 + (DT_MS * (d - xp)) / (x - xp)));
    }
    if (x >= 400) return { finish: Math.round(t0 + (DT_MS * (400 - xp)) / (x - xp)), splits };
  }
  throw new Error('no finish');
}

describe('400 m expected times (design 14.2)', () => {
  // [rate, finish s, splits s, lowest stamina 0-100]
  const table: [number, number, [number, number, number], number][] = [
    [6.0, 68.9, [18.7, 35.4, 52.1], 99],
    [7.0, 59.3, [16.3, 30.6, 45.0], 99],
    [7.5, 55.5, [15.3, 28.7, 42.1], 60],
    [8.0, 52.2, [14.5, 27.0, 39.6], 26],
    [8.25, 50.6, [14.1, 26.3, 38.5], 10],
    [8.5, 51.6, [13.8, 25.6, 37.4], 0],
    [9.0, 54.1, [13.1, 24.3, 36.9], 0],
    [10.0, 56.9, [12.0, 22.7, 39.7], 0],
    [12.0, 59.6, [10.3, 25.5, 42.6], 0],
  ];
  it.each(table)('even %s alt/s finishes in ~%s s', (rate, finish, splits, lowest) => {
    const { race, goWall } = startRace('400m', 'pip');
    let minS = 1;
    drive(race, goWall, { rate, onTick: (st) => (minS = Math.min(minS, st.player.stamina ?? 1)) });
    const o = race.state.outcome;
    expect(Math.abs((o?.ms ?? 0) / 1000 - finish)).toBeLessThan(0.25);
    expect(o?.splits).toHaveLength(3);
    o?.splits.forEach((ms, i) => expect(Math.abs(ms / 1000 - (splits[i] ?? 0))).toBeLessThan(0.2));
    expect(Math.abs(minS * 100 - lowest)).toBeLessThan(3);
  });

  it('12 alt/s while S >= 0.30, 6.0 below (the table row policy): ~52.2 s, never below ~28', () => {
    const { race, goWall } = startRace('400m', 'pip');
    let minS = 1;
    drive(race, goWall, {
      rate: (_ms, s) => (s < 0.3 ? 6 : 12),
      onTick: (st) => (minS = Math.min(minS, st.player.stamina ?? 1)),
    });
    expect(Math.abs((race.state.outcome?.ms ?? 0) - 52200)).toBeLessThan(250);
    expect(Math.abs(minS * 100 - 28)).toBeLessThan(3);
  });
});

describe('400 m acceptance (design 22)', () => {
  it('flat out empties stamina within ~100-150 m, slows to ~22 km/h and finishes near 60 s', () => {
    const { race, goWall } = startRace('400m', 'pip');
    let emptyAt: number | null = null;
    let lateV = 0;
    let tired = false;
    let sweat = false;
    const log = drive(race, goWall, {
      rate: 12,
      onTick: (st) => {
        if (emptyAt === null && (st.player.stamina ?? 1) < 0.01) emptyAt = st.player.xM;
        if (st.player.xM > 250 && st.player.xM < 260) lateV = st.player.vMps;
        tired ||= st.player.anim === 'tired';
        sweat ||= st.player.effect === 'sweat';
      },
    });
    expect(emptyAt).not.toBeNull();
    expect(emptyAt ?? 0).toBeGreaterThan(100);
    expect(emptyAt ?? 0).toBeLessThan(160);
    // The outcome keeps the whole metre where the meter first emptied.
    expect(Math.abs((race.state.outcome?.staminaEmptyM ?? 0) - (emptyAt ?? 0))).toBeLessThanOrEqual(1);
    expect(Math.round(lateV * 3.6)).toBeGreaterThanOrEqual(21);
    expect(Math.round(lateV * 3.6)).toBeLessThanOrEqual(23);
    expect(Math.abs((race.state.outcome?.ms ?? 0) - 59600)).toBeLessThan(300);
    expect(tired && sweat).toBe(true);
    expect(count(log, 'staminaEmpty')).toBeGreaterThan(1);
    expect(count(log, 'staminaLow')).toBeGreaterThan(10);
  });

  it('stopping when empty refills the meter (arrow up) and lifts the cap', () => {
    const { race, goWall } = startRace('400m', 'pip');
    drive(race, goWall, { rate: 12, untilMs: 20000 });
    expect(race.state.player.stamina ?? 1).toBeLessThan(0.05);
    expect(race.state.staminaDraining).toBe(true);
    const s0 = race.state.player.stamina ?? 0;
    play(race, [], goWall + 20000, goWall + 23000);
    expect(race.state.staminaDraining).toBe(false);
    expect((race.state.player.stamina ?? 0) - s0).toBeCloseTo(0.294, 2);
  });

  it('staminaDraining follows the step rate around SUSTAIN_RATE (7 alt/s)', () => {
    const at = (rate: number): boolean => {
      const { race, goWall } = startRace('400m', 'pip');
      drive(race, goWall, { rate, untilMs: 5000 });
      return race.state.staminaDraining;
    };
    expect(at(8)).toBe(true);
    expect(at(7.5)).toBe(true);
    expect(at(6.5)).toBe(false);
    expect(at(5)).toBe(false);
  });

  it('splits at 100/200/300 m are the interpolated crossings of rule 2.6 (exact vs a reference)', () => {
    const rel = Array.from({ length: 700 }, (_, i) => 3 + i * 121.7 + (i % 3) * 7);
    const presses = (go: number): RunKeyEvent[] =>
      rel.flatMap((r, i): RunKeyEvent[] => {
        const side = i % 2 === 0 ? 'L' : 'R';
        return [down(side, go + r), up(side, go + r + 20)];
      });
    const race = new Race({ event: '400m', opponent: 'sol', seed: 5, startT: START_T });
    const go = runToGo(race);
    const log = play(race, presses(go), go, go + 89000);
    const ref = reference400(rel);
    expect(race.state.outcome?.ms).toBe(ref.finish);
    expect(race.state.outcome?.splits).toEqual(ref.splits);
    expect(log.filter((e) => e.type === 'split')).toEqual(
      ref.splits.map((ms, index) => ({ type: 'split', index, ms })),
    );
    // The bell rings right after the 300 m split.
    const i300 = log.findIndex((e) => e.type === 'split' && e.index === 2);
    expect(log[i300 + 1]).toEqual({ type: 'bell' });
    expect(count(log, 'bell')).toBe(1);
  });

  it('the DNF cap is 90 s and a DNF keeps the splits it reached', () => {
    const { race, goWall } = startRace('400m', 'pip');
    drive(race, goWall, { rate: 5, untilMs: 25000 });
    play(race, [], goWall + 25000, goWall + 90100);
    const o = race.state.outcome;
    expect(o).toMatchObject({ result: 'dnf', ms: null, hit: null, event: '400m' });
    expect(o?.splits.length).toBeGreaterThanOrEqual(1);
    expect(o?.splits.length).toBeLessThan(3);
    expect(race.state.timerMs).toBe(90000);
  });

  it('lean at 398-402 m; stamina only for the player; no hurdles', () => {
    const { race, goWall } = startRace('400m', 'kofi');
    const lean: number[] = [];
    drive(race, goWall, {
      rate: 8,
      onTick: (st) => {
        if (st.player.anim === 'lean') lean.push(st.player.xM);
      },
    });
    expect(Math.min(...lean)).toBeGreaterThanOrEqual(397.9);
    expect(race.state.rival.stamina).toBeNull();
    expect(race.state.player.hurdlesKnocked).toEqual([]);
    expect(race.state.nextHurdleIndex).toBeNull();
    expect(race.state.nextHurdleS).toBeNull();
  });
});

describe('determinism (400 m)', () => {
  it('frame chunking does not change outcome, splits or events', () => {
    const presses = (go: number): RaceInput[] => alternate(go + 7.1, 118.3, 600, 23);
    const chunkings: (readonly number[])[] = [[1000 / 60], [33.4, 5, 16.7, 50, 2.2], [DT_MS]];
    const results = chunkings.map((frames) => {
      const race = new Race({ event: '400m', opponent: 'zyx', seed: 9, startT: START_T });
      const go = runToGo(race);
      const log = play(race, presses(go), go, go + 75000, frames);
      return { outcome: race.state.outcome, events: log.map((e) => JSON.stringify(e)).join(',') };
    });
    for (const r of results.slice(1)) expect(r).toEqual(results[0]);
  });
});
