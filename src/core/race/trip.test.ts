import { describe, expect, it } from 'vitest';
import type { EventId, InputSource, RaceEvent, RaceState, Side } from '../index.ts';
import { TUNING } from '../index.ts';
import { DT_MS } from '../clock/clock.ts';
import { Race } from './race.ts';
import { runToGo, START_T } from './testkit.ts';

// Design 33: rule C trip behind the `trip` flag, keyboard only; 33.5 fumble logging always on.

const FALL_MS = TUNING.TRIP_BLEED_MS;
const LIE_MS = TUNING.TRIP_LIE_MS;

interface Run {
  readonly race: Race;
  readonly go: number;
  readonly log: RaceEvent[];
  /** State after each tick, keyed by the wall time of the advance. */
  readonly states: { wall: number; st: RaceState }[];
  /** Advance tick by tick to `wall`. */
  to(wall: number): void;
  /** One press (down, up 5 ms later) at `wall`, then advance past it. */
  press(side: Side, wall: number, source?: InputSource): void;
}

function start(opts: { event?: EventId; trip?: boolean; seed?: number } = {}): Run {
  const race = new Race({
    event: opts.event ?? '100m',
    opponent: opts.event === '400m' ? 'pip' : 'pip',
    seed: opts.seed ?? 1,
    startT: START_T,
    ...(opts.trip === undefined ? {} : { trip: opts.trip }),
  });
  const log: RaceEvent[] = [];
  const go = runToGo(race, log);
  const states: { wall: number; st: RaceState }[] = [];
  let now = go;
  const run: Run = {
    race,
    go,
    log,
    states,
    to(wall) {
      while (now + DT_MS <= wall + 1e-9) {
        now += DT_MS;
        log.push(...race.advance(now));
        states.push({ wall: now, st: race.state });
      }
    },
    press(side, wall, source) {
      const src = source === undefined ? {} : { source };
      race.input({ kind: 'down', side, t: wall, repeat: false, ...src });
      race.input({ kind: 'up', side, t: wall + 5, repeat: false, ...src });
    },
  };
  return run;
}

/** Alternate L, R, ... every `period` ms from `from` for `n` presses; returns the side of the last one. */
function mash(r: Run, from: number, n: number, period = 100): Side {
  let side: Side = 'L';
  for (let i = 0; i < n; i++) {
    side = i % 2 === 0 ? 'L' : 'R';
    r.press(side, from + i * period);
    r.to(from + i * period + 1);
  }
  return side;
}

const types = (log: readonly RaceEvent[]): string[] => log.map((e) => e.type);
const count = (log: readonly RaceEvent[], type: string): number => log.filter((e) => e.type === type).length;

describe('trip flag off (shipping default): v2 fumble only (design 33.1, 38)', () => {
  it('two fumbles in a row only fumble; the pair is still counted as fumble2', () => {
    expect(TUNING.TRIP_ENABLED).toBe(false);
    const r = start();
    const last = mash(r, r.go + 5, 20);
    const t = r.go + 5 + 19 * 100;
    r.press(last, t + 100);
    r.press(last, t + 200);
    r.to(t + 1500);
    expect(count(r.log, 'fumble')).toBe(2);
    expect(count(r.log, 'trip')).toBe(0);
    expect(r.states.every((s) => s.st.trip === 'none')).toBe(true);
    mash(r, t + 300, 200, 100);
    r.to(r.go + 30000);
    expect(r.race.state.outcome).toMatchObject({ fumbles: 2, fumble2: 1, trips: 0, input: 'k' });
  });

  it('explicit trip: false behaves exactly like the default', () => {
    const play = (trip?: boolean): string => {
      const r = start(trip === undefined ? {} : { trip });
      const last = mash(r, r.go + 5, 21);
      r.press(last, r.go + 2105);
      r.press(last, r.go + 2205);
      mash(r, r.go + 2305, 200);
      r.to(r.go + 30000);
      return JSON.stringify([r.race.state.outcome, r.log]);
    };
    expect(play(false)).toBe(play());
  });
});

describe('trip flag on (design 33.1-33.2)', () => {
  /** Mash 2 s, then a key fumble pair at +100 / +200 ms after the last step. */
  function tripAt(trip: boolean, source2: InputSource = 'k', source1: InputSource = 'k') {
    const r = start({ trip });
    const last = mash(r, r.go + 5, 21); // last step at go + 2005
    r.press(last, r.go + 2105, source1);
    r.press(last, r.go + 2205, source2);
    // An input applies at the first tick boundary at or after it, simulated within 2 ticks.
    r.to(r.go + 2205 + 2 * DT_MS + 1);
    return { r, last, tripWall: r.go + 2205 };
  }

  it('falls (speed to 0 over 0.25 s), lies 0.40 s, gets up at 30% of the trigger speed', () => {
    const { r, tripWall } = tripAt(true);
    expect(count(r.log, 'trip')).toBe(1);
    expect(r.race.state.trip).toBe('fall');
    expect(r.race.state.player.anim).toBe('fall');
    // The speed at the trigger is the speed when the second fumble lands (one tick of drag after it).
    const at = r.states.find((s) => s.wall >= tripWall)?.st.player.vMps ?? 0;
    r.to(tripWall + FALL_MS / 2);
    expect(r.race.state.player.vMps).toBeLessThan(at * 0.6);
    expect(r.race.state.player.vMps).toBeGreaterThan(at * 0.4);
    r.to(tripWall + FALL_MS + 20);
    expect(r.race.state.trip).toBe('lie');
    expect(r.race.state.player.anim).toBe('lie');
    expect(r.race.state.player.vMps).toBe(0);
    r.to(tripWall + FALL_MS + LIE_MS - 20);
    expect(r.race.state.trip).toBe('lie');
    const before = r.log.length;
    r.to(tripWall + FALL_MS + LIE_MS + 20);
    const up = r.log.slice(before);
    expect(types(up)).toContain('tripUp');
    expect(r.race.state.trip).toBe('getup');
    expect(r.race.state.player.anim).toBe('getup');
    // Either side is accepted next (key prompt shows both bright).
    expect(r.race.state.expectedSide).toBeNull();
    r.to(tripWall + FALL_MS + LIE_MS + TUNING.TRIP_GETUP_MS + 30);
    expect(r.race.state.trip).toBe('none');
  });

  it('keeps TRIP_KEEP x the speed at the trigger on getting up', () => {
    const { r, tripWall } = tripAt(true);
    const trigger = r.states.filter((s) => s.wall <= tripWall).at(-1)?.st.player.vMps ?? 0;
    const upAt = tripWall + FALL_MS + LIE_MS;
    r.to(upAt + 30);
    const upState = r.states.find((s) => s.st.trip === 'getup')?.st;
    // One tick of drag after the reset at most.
    expect(upState?.player.vMps).toBeGreaterThan(TUNING.TRIP_KEEP * trigger * 0.98);
    expect(upState?.player.vMps).toBeLessThanOrEqual(TUNING.TRIP_KEEP * trigger * 1.01);
  });

  it('ignores presses while down (no step, no fumble)', () => {
    const finish = (trip: boolean): { ms: number | null; log: RaceEvent[] } => {
      const { r, last } = tripAt(trip);
      const other: Side = last === 'L' ? 'R' : 'L';
      const from = r.log.length;
      // Presses during the fall and the lie.
      r.press(other, r.go + 2300);
      r.press(last, r.go + 2400);
      r.press(other, r.go + 2600);
      r.to(r.go + 2700);
      const during = r.log.slice(from).filter((e) => e.type === 'step' || e.type === 'fumble');
      if (trip) expect(during).toEqual([]);
      mash(r, r.go + 2905, 400);
      r.to(r.go + 30000);
      return { ms: r.race.state.outcome?.ms ?? null, log: r.log };
    };
    const tripped = finish(true);
    const fumbled = finish(false);
    expect(tripped.ms).toBeGreaterThan(fumbled.ms ?? 0);
  });

  it('costs about 1.45 s at cruise (10 alt/s, design 33.2)', () => {
    const finish = (trip: boolean): number => {
      const r = start({ trip });
      const last = mash(r, r.go + 5, 61); // ~10 m/s after 6 s
      r.press(last, r.go + 6105);
      r.press(last, r.go + 6205);
      r.to(r.go + 6300);
      mash(r, r.go + 6305, 400);
      r.to(r.go + 30000);
      return r.race.state.outcome?.ms ?? 0;
    };
    const cost = finish(true) - finish(false);
    expect(cost).toBeGreaterThan(1250);
    expect(cost).toBeLessThan(1650);
  });

  it('a held side stays held through the trip: it cannot step until released and re-pressed', () => {
    const { r, last } = tripAt(true);
    const other: Side = last === 'L' ? 'R' : 'L';
    r.race.input({ kind: 'down', side: other, t: r.go + 2300, repeat: false });
    r.to(r.go + 3000); // up again (getup at ~2855)
    const from = r.log.length;
    r.race.input({ kind: 'down', side: other, t: r.go + 3010, repeat: false });
    r.to(r.go + 3020);
    expect(r.log.slice(from).filter((e) => e.type === 'step')).toEqual([]);
    r.race.input({ kind: 'up', side: other, t: r.go + 3030, repeat: false });
    r.race.input({ kind: 'up', side: other, t: r.go + 3031, repeat: false });
    r.press(other, r.go + 3040);
    r.to(r.go + 3050);
    expect(r.log.slice(from).filter((e) => e.type === 'step')).toHaveLength(1);
  });

  it('window: a second fumble more than TRIP_WINDOW after the first is not a pair', () => {
    const r = start({ trip: true });
    const last = mash(r, r.go + 5, 21);
    r.press(last, r.go + 2105);
    r.press(last, r.go + 2105 + TUNING.TRIP_WINDOW_MS + 10);
    r.to(r.go + 3500);
    expect(count(r.log, 'fumble')).toBe(2);
    expect(count(r.log, 'trip')).toBe(0);
    // Inside the window it is a pair.
    const s = start({ trip: true });
    const l2 = mash(s, s.go + 5, 21);
    s.press(l2, s.go + 2105);
    s.press(l2, s.go + 2105 + TUNING.TRIP_WINDOW_MS);
    s.to(s.go + 3500);
    expect(count(s.log, 'trip')).toBe(1);
  });

  it('a valid step between two fumbles breaks the pair (rule C, not rule B)', () => {
    const r = start({ trip: true });
    const last = mash(r, r.go + 5, 21);
    const other: Side = last === 'L' ? 'R' : 'L';
    r.press(last, r.go + 2105); // fumble
    r.press(other, r.go + 2205); // step
    r.press(other, r.go + 2305); // fumble
    r.to(r.go + 3000);
    expect(count(r.log, 'fumble')).toBe(2);
    expect(count(r.log, 'trip')).toBe(0);
    mash(r, r.go + 3005, 300);
    r.to(r.go + 30000);
    expect(r.race.state.outcome).toMatchObject({ fumbles: 2, fumble2: 0, trips: 0 });
  });

  it('touch never trips, but its pairs are logged; mixed input follows the press completing the pair', () => {
    const touch = tripAt(true, 't', 't').r;
    expect(count(touch.log, 'trip')).toBe(0);
    expect(count(touch.log, 'fumble')).toBe(2);
    const keyThenTouch = tripAt(true, 't', 'k').r;
    expect(count(keyThenTouch.log, 'trip')).toBe(0);
    const touchThenKey = tripAt(true, 'k', 't').r;
    expect(count(touchThenKey.log, 'trip')).toBe(1);
    for (const r of [touch, keyThenTouch]) {
      mash(r, r.go + 2405, 300);
      r.to(r.go + 30000);
    }
    expect(touch.race.state.outcome).toMatchObject({ fumble2: 1, trips: 0, input: 'm' });
  });

  it('a trigger in the air starts the fall at landing (hurdles)', () => {
    const r = start({ event: '110mh', trip: true });
    const last = mash(r, r.go + 5, 11); // last step at go + 1005, well before H1
    r.race.input({ kind: 'down', action: 'jump', t: r.go + 1050, repeat: false });
    r.race.input({ kind: 'up', action: 'jump', t: r.go + 1055, repeat: false });
    r.to(r.go + 1060);
    expect(r.race.state.player.airM).toBeGreaterThanOrEqual(0);
    r.press(last, r.go + 1100);
    r.press(last, r.go + 1150);
    r.to(r.go + 1160);
    expect(count(r.log, 'trip')).toBe(0);
    expect(r.race.state.trip).toBe('none');
    const from = r.log.length;
    r.to(r.go + 1500);
    const after = types(r.log.slice(from)).filter((t) => t === 'land' || t === 'trip');
    expect(after).toEqual(['land', 'trip']);
    const landIdx = r.log.findIndex((e, i) => i >= from && e.type === 'land');
    expect(r.log[landIdx + 1]?.type).toBe('trip');
  });

  it('a hurdle crossed while down is a HIT with no extra stumble (speed keeps bleeding)', () => {
    const r = start({ event: '110mh', trip: true });
    // Mash without jumping, then pair-fumble just before H1 (13.72 m).
    let side: Side = 'L';
    let t = r.go + 5;
    let lastSide: Side = 'L';
    while ((r.race.state.nextHurdleS ?? 9) > 0.06 && t < r.go + 5000) {
      r.press(side, t);
      lastSide = side;
      side = side === 'L' ? 'R' : 'L';
      r.to(t + 1);
      for (let k = 0; k < 12 && (r.race.state.nextHurdleS ?? 9) > 0.06; k++) r.to(t + 1 + (k + 1) * DT_MS);
      t = r.states.at(-1)?.wall ?? t;
      t += 1;
    }
    const wall = r.states.at(-1)?.wall ?? 0;
    r.press(lastSide, wall + 1);
    r.press(lastSide, wall + 12);
    r.to(wall + 400);
    const hits = r.log.filter((e) => e.type === 'hurdleHit' && e.lane === 0);
    expect(count(r.log, 'trip')).toBe(1);
    expect(hits).toEqual([{ type: 'hurdleHit', lane: 0, index: 0 }]);
    // No stumble anim and no x0.40 drop: the fall keeps bleeding linearly, then the lie.
    const tripStates = r.states.filter((s) => s.wall > wall + 3);
    expect(tripStates.some((s) => s.st.player.anim === 'stumble')).toBe(false);
    expect(r.race.state.player.hurdlesKnocked[0]).toBe(true);
    expect(r.race.state.trip).toBe('lie');
  });

  it('400 m: stamina keeps regenerating while down', () => {
    const r = start({ event: '400m', trip: true });
    const last = mash(r, r.go + 5, 41, 70); // fast mashing drains stamina
    const t = r.go + 5 + 40 * 70;
    r.to(t + 10);
    r.press(last, t + 50);
    r.press(last, t + 100);
    r.to(t + 100 + 2 * DT_MS + 1);
    expect(r.race.state.trip).toBe('fall');
    const s0 = r.race.state.player.stamina ?? 0;
    r.to(t + 100 + FALL_MS + LIE_MS - 10);
    const s1 = r.race.state.player.stamina ?? 0;
    expect(s1 - s0).toBeCloseTo((TUNING.REGEN * (FALL_MS + LIE_MS - 10)) / 1000, 2);
  });
});

describe('fumble logging (design 33.5)', () => {
  it('counts valid steps, fumbles, rule C pairs, trips and the input modality', () => {
    const r = start({ trip: true });
    const last = mash(r, r.go + 5, 21);
    r.press(last, r.go + 2105, 't');
    r.press(last, r.go + 2205, 't'); // pair 1 (touch, no trip)
    r.press(last, r.go + 2305); // fumble, new streak
    r.press(last, r.go + 2405); // pair 2 (key): trip
    r.to(r.go + 3500);
    mash(r, r.go + 3505, 300);
    r.to(r.go + 40000);
    const o = r.race.state.outcome;
    expect(o).toMatchObject({ fumbles: 4, fumble2: 2, trips: 1, input: 'm' });
    expect(o?.steps).toBe(count(r.log, 'step'));
    expect(o?.fumbles).toBe(count(r.log, 'fumble'));
  });

  it('input is k for keys only, t for touch only', () => {
    const only = (source: InputSource): string | undefined => {
      const r = start();
      for (let i = 0; i < 300; i++) r.press(i % 2 === 0 ? 'L' : 'R', r.go + 5 + i * 100, source);
      r.to(r.go + 31000);
      return r.race.state.outcome?.input;
    };
    expect(only('k')).toBe('k');
    expect(only('t')).toBe('t');
  });
});
