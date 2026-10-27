import { describe, expect, it } from 'vitest';
import type { RaceEvent, RaceInput, RaceState } from '../index.ts';
import { DT_MS } from '../clock/clock.ts';
import { alternate, drive, jumpPress, merge, play, runToGo, startRace, START_T } from './testkit.ts';
import { Race } from './race.ts';

// Design 13 in the full race loop (player lane), plus jump input rules.

const playerHurdles = (log: RaceEvent[]): string[] =>
  log.flatMap((e) => ('lane' in e && e.lane === 0 && e.type.startsWith('hurdle') ? [e.type] : []));
const count = (log: RaceEvent[], type: string): number => log.filter((e) => e.type === type).length;
const jumpDown = (t: number, repeat = false): RaceInput => ({ kind: 'down', action: 'jump', t, repeat });
const jumpUp = (t: number): RaceInput => ({ kind: 'up', action: 'jump', t, repeat: false });

describe('hurdles race times (design 13.3)', () => {
  it('10 alt/s with clean sweet-spot jumps finishes in about 14.5 s with CLEAN RACE (hit 0)', () => {
    const { race, goWall } = startRace('110mh', 'kofi');
    const log = drive(race, goWall, { rate: 10, jumpS: 0.2 });
    const o = race.state.outcome;
    expect(o?.hit).toBe(0);
    expect(Math.abs((o?.ms ?? 0) - 14470)).toBeLessThan(300);
    expect(playerHurdles(log)).toEqual(Array.from({ length: 10 }, () => 'hurdleClear'));
    expect(
      count(
        log.filter((e) => 'lane' in e && e.lane === 0),
        'jump',
      ),
    ).toBe(10);
  });

  it('never jumping knocks all 10 with a stumble each and still finishes under 40 s (r = 6: ~32.4 s)', () => {
    const fast = startRace('110mh', 'pip');
    const fastLog = drive(fast.race, fast.goWall, { rate: 10 });
    expect(fast.race.state.outcome?.hit).toBe(10);
    expect(playerHurdles(fastLog)).toEqual(Array.from({ length: 10 }, () => 'hurdleHit'));
    expect(Math.abs((fast.race.state.outcome?.ms ?? 0) - 23700)).toBeLessThan(300);
    const slow = startRace('110mh', 'pip');
    drive(slow.race, slow.goWall, { rate: 6 });
    const o = slow.race.state.outcome;
    expect(o?.result === 'win' || o?.result === 'lose').toBe(true);
    expect(o?.ms ?? 99999).toBeLessThan(40000);
    expect(Math.abs((o?.ms ?? 0) - 32400)).toBeLessThan(300);
  });

  it('every jump late costs a CLIP each (~+0.36 s at r = 10), much less than a HIT (~+1.28 s)', () => {
    const clean = startRace('110mh', 'kofi');
    drive(clean.race, clean.goWall, { rate: 10, jumpS: 0.2 });
    const late = startRace('110mh', 'kofi');
    const log = drive(late.race, late.goWall, { rate: 10, jumpS: 0.05 });
    expect(playerHurdles(log)).toEqual(Array.from({ length: 10 }, () => 'hurdleClip'));
    expect(late.race.state.outcome?.hit).toBe(10);
    const perClip = ((late.race.state.outcome?.ms ?? 0) - (clean.race.state.outcome?.ms ?? 0)) / 10;
    expect(perClip).toBeGreaterThan(250);
    expect(perClip).toBeLessThan(450);
  });

  it('the DNF cap is 40 s', () => {
    const { race, goWall } = startRace('110mh', 'pip');
    const log = play(race, [], goWall, goWall + 40100);
    expect(count(log, 'dnf')).toBe(1);
    expect(race.state.outcome).toMatchObject({ result: 'dnf', ms: null, hit: 0, event: '110mh' });
    expect(race.state.timerMs).toBe(40000);
  });
});

describe('jump input (design 13.2, 13.4)', () => {
  it('a jump after GO takes off, raises the runner with the hurdle anim, and lands 0.40 s later', () => {
    const { race, goWall } = startRace('110mh', 'kofi');
    const samples: RaceState['player'][] = [];
    const presses = merge(alternate(goWall + 5, 100, 20), jumpPress(goWall + 1000));
    let i = 0;
    const log: RaceEvent[] = [];
    for (let now = goWall; now < goWall + 1600; now += DT_MS / 2) {
      while (i < presses.length && (presses[i]?.t ?? Infinity) <= now) race.input(presses[i++] as RaceInput);
      log.push(...race.advance(now));
      samples.push(race.state.player);
    }
    const jumps = log.filter((e) => e.type === 'jump');
    expect(jumps).toEqual([{ type: 'jump', lane: 0 }]);
    expect(log).toContainEqual({ type: 'land', lane: 0 });
    const air = samples.filter((p) => p.airPhase !== null);
    expect(air.every((p) => p.anim === 'hurdle')).toBe(true);
    const peak = Math.max(...air.map((p) => p.airM));
    expect(peak).toBeGreaterThan(1.25);
    expect(peak).toBeLessThanOrEqual(1.3);
    expect(air.length * (DT_MS / 2)).toBeCloseTo(400, -1);
    // Grounded runners report no arc.
    expect(samples[0]).toMatchObject({ airM: 0, airPhase: null });
  });

  it('steps in the air are classified (alternation kept, no fumble), flagged airborne and give no speed', () => {
    const { race, goWall } = startRace('110mh', 'kofi');
    play(race, alternate(goWall + 5, 100, 10), goWall, goWall + 1000);
    const log = play(
      race,
      merge(jumpPress(goWall + 1000), alternate(goWall + 1050, 100, 3)),
      goWall + 1000,
      goWall + 1200,
    );
    const v0 = race.state.player.vMps;
    const airSteps = log.filter((e) => e.type === 'step');
    expect(airSteps.length).toBeGreaterThan(0);
    expect(airSteps.every((e) => e.type === 'step' && e.airborne === true)).toBe(true);
    expect(count(log, 'fumble')).toBe(0);
    play(
      race,
      alternate(goWall + 1250, 100, 1).map((e) => ({ ...e, side: 'R' as const })),
      goWall + 1200,
      goWall + 1350,
    );
    expect(race.state.player.vMps).toBeLessThanOrEqual(v0);
    // The expected side keeps alternating through the air.
    expect(race.state.expectedSide).not.toBeNull();
  });

  it('is ignored (no fumble, no event) while airborne, during the landing lock, and after the finish', () => {
    const { race, goWall } = startRace('110mh', 'kofi');
    play(race, alternate(goWall + 5, 100, 10), goWall, goWall + 1000);
    const presses = [
      jumpDown(goWall + 1000),
      jumpUp(goWall + 1010),
      jumpDown(goWall + 1200), // airborne
      jumpUp(goWall + 1210),
      jumpDown(goWall + 1450), // 0.05 s after the landing at ~1400: locked
      jumpUp(goWall + 1460),
    ];
    const log = play(race, presses, goWall + 1000, goWall + 1600);
    expect(count(log, 'jump')).toBe(1);
    expect(count(log, 'fumble')).toBe(0);
    const again = play(race, jumpPress(goWall + 1700), goWall + 1600, goWall + 1800);
    expect(count(again, 'jump')).toBe(1);
  });

  it('holding jump never jumps twice: repeats are ignored', () => {
    const { race, goWall } = startRace('110mh', 'kofi');
    const presses: RaceInput[] = [jumpDown(goWall + 100)];
    for (let t = goWall + 600; t < goWall + 2000; t += 30) presses.push(jumpDown(t, true));
    expect(count(play(race, presses, goWall, goWall + 2100), 'jump')).toBe(1);
  });

  it('cross-source: a second source pressing jump while the first holds it does nothing', () => {
    const { race, goWall } = startRace('110mh', 'kofi');
    const presses = [jumpDown(goWall + 100), jumpDown(goWall + 700), jumpUp(goWall + 800)];
    expect(count(play(race, presses, goWall, goWall + 900), 'jump')).toBe(1);
    // Both lifted: the next press jumps.
    const more = [jumpUp(goWall + 950), jumpDown(goWall + 1000)];
    expect(count(play(race, more, goWall + 900, goWall + 1100), 'jump')).toBe(1);
  });

  it('a fresh jump in the countdown window is a false start in the hurdles', () => {
    const race = new Race({ event: '110mh', opponent: 'jess', seed: 1, startT: START_T });
    const log = play(race, [jumpDown(START_T + 1800)], START_T, START_T + 1900);
    expect(log).toContainEqual({ type: 'falseStart', count: 1 });
  });

  it('jump during the walk-in, held through the countdown, is not a false start', () => {
    const race = new Race({ event: '110mh', opponent: 'jess', seed: 1, startT: START_T });
    const log = play(race, [jumpDown(START_T + 1000)], START_T, START_T + 5000);
    expect(count(log, 'falseStart')).toBe(0);
  });

  it('two jump false starts disqualify; the DQ outcome reports hit 0', () => {
    const race = new Race({ event: '110mh', opponent: 'jess', seed: 1, startT: START_T });
    const log = play(
      race,
      [jumpDown(START_T + 1800), jumpUp(START_T + 1850), jumpDown(START_T + 4000)],
      START_T,
      START_T + 4100,
    );
    expect(count(log, 'disqualified')).toBe(1);
    expect(race.state.outcome).toMatchObject({ result: 'dq', hit: 0, splits: [] });
  });

  it.each(['100m', '400m'] as const)(
    'in the %s Up/W is not a race input: no false start, no jump',
    (event) => {
      const race = new Race({ event, opponent: 'jess', seed: 1, startT: START_T });
      const log = play(race, [jumpDown(START_T + 1800)], START_T, START_T + 5000);
      expect(count(log, 'falseStart')).toBe(0);
      const go = START_T + 5000;
      const after = play(race, [jumpUp(go + 10), jumpDown(go + 50)], go, go + 600);
      expect(count(after, 'jump')).toBe(0);
      expect(race.state.player.airPhase).toBeNull();
    },
  );
});

describe('hurdles HUD state (design 18.4)', () => {
  it('nextHurdleIndex/S track the next hurdle; null below 1 m/s and after H10', () => {
    const { race, goWall } = startRace('110mh', 'kofi');
    expect(race.state.nextHurdleIndex).toBe(0);
    expect(race.state.nextHurdleS).toBeNull(); // standing
    const seen = new Set<number | null>();
    let checked = false;
    drive(race, goWall, {
      rate: 10,
      jumpS: 0.2,
      onTick: (st) => {
        seen.add(st.nextHurdleIndex);
        if (!checked && st.player.vMps > 5 && st.nextHurdleIndex === 2) {
          const h = 32.0;
          // Uses the sim position (one tick ahead of the interpolated xM).
          expect(st.nextHurdleS).toBeGreaterThan(0);
          expect(st.nextHurdleS ?? 0).toBeCloseTo((h - st.player.xM) / st.player.vMps, 1);
          checked = true;
        }
      },
    });
    expect(checked).toBe(true);
    expect([...seen]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, null]);
    expect(race.state.nextHurdleS).toBeNull();
  });

  it('knocked flags per lane and per hurdle; the outcome counts CLIP plus HIT', () => {
    const { race, goWall } = startRace('110mh', 'pip');
    const log = drive(race, goWall, { rate: 10, jumpS: 0.2, jumpAt: (i) => i % 2 === 0 });
    expect(race.state.player.hurdlesKnocked).toEqual(Array.from({ length: 10 }, (_, i) => i % 2 === 1));
    expect(race.state.outcome?.hit).toBe(5);
    expect(playerHurdles(log)).toEqual(
      Array.from({ length: 10 }, (_, i) => (i % 2 === 0 ? 'hurdleClear' : 'hurdleHit')),
    );
    // Pip's scripted hits at H3 and H7 show in his lane, with lane 'rival' events.
    expect(race.state.rival.hurdlesKnocked[2]).toBe(true);
    expect(race.state.rival.hurdlesKnocked[6]).toBe(true);
    expect(log).toContainEqual({ type: 'hurdleHit', lane: 1, index: 2 });
    expect(race.state.player.stamina).toBeNull();
    expect(race.state.splits).toEqual([]);
  });

  it('lean anim at 108-112 m', () => {
    const { race, goWall } = startRace('110mh', 'pip');
    const leanAt: number[] = [];
    drive(race, goWall, {
      rate: 11,
      jumpS: 0.2,
      untilMs: 20000,
      onTick: (st) => {
        if (st.player.anim === 'lean') leanAt.push(st.player.xM);
      },
    });
    expect(Math.min(...leanAt)).toBeGreaterThanOrEqual(107.9);
    expect(Math.max(...leanAt)).toBeLessThan(112.1);
  });

  it('each HIT shows the stumble anim for 0.30 s', () => {
    const { race, goWall } = startRace('110mh', 'pip');
    let stumbleTicks = 0;
    drive(race, goWall, {
      rate: 10,
      onTick: (st) => {
        if (st.player.anim === 'stumble') stumbleTicks++;
      },
    });
    expect(race.state.outcome?.hit).toBe(10);
    expect(stumbleTicks).toBe(10 * 36);
  });
});

describe('determinism (hurdles)', () => {
  it('frame chunking does not change outcome or events', () => {
    const presses = (go: number): RaceInput[] =>
      merge(
        alternate(go + 7.1, 97.3, 200, 23),
        [1300, 2250, 3110, 4040].flatMap((t) => jumpPress(go + t)),
      );
    const chunkings: (readonly number[])[] = [[1000 / 60], [1000 / 144], [33.4, 5, 16.7, 50, 2.2], [DT_MS]];
    const results = chunkings.map((frames) => {
      const race = new Race({ event: '110mh', opponent: 'marco', seed: 77, startT: START_T });
      const goWall = runToGo(race);
      const log = play(race, presses(goWall), goWall, goWall + 25000, frames);
      return { outcome: race.state.outcome, events: log.map((e) => JSON.stringify(e)).join(',') };
    });
    for (const r of results.slice(1)) expect(r).toEqual(results[0]);
  });
});
