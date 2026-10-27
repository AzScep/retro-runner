import { describe, expect, it } from 'vitest';
import type { EventId, LaneCharacter, OpponentId, RaceEvent, RaceState } from '../index.ts';
import { FIELD_SIZE, fieldRunners, LADDERS, meet, OPPONENTS, TUNING } from '../index.ts';
import { DT_MS } from '../clock/clock.ts';
import { fieldSpecAndPlan, planField } from '../field/field.ts';
import { planRival, RivalSim, simulateRivalFinish } from '../opponents/ai.ts';
import { mulberry32 } from '../rng/mulberry32.ts';
import { createAi, Race, rankStandings } from './race.ts';
import { alternate, drive, play, runRace, runToGo, startRace, START_T } from './testkit.ts';

// Design 24-25 in the full race: 6 runners, lanes, seeding, places, standings and the v3 events.

const laneOf = (e: RaceEvent): number | null => ('lane' in e ? e.lane : null);
const fieldName = (w: LaneCharacter): string | null => (w.kind === 'field' ? w.field.name : null);

/** Advance with no player input until every runner has crossed and stopped (or `maxMs`). */
function runOut(race: Race, goWall: number, maxMs = 100000): RaceEvent[] {
  const log: RaceEvent[] = [];
  for (let k = 1; k * DT_MS <= maxMs; k++) {
    log.push(...race.advance(goWall + k * DT_MS));
    const st = race.state;
    if (st.outcome !== null && st.runners.every((r) => r.state.finishMs !== null && r.state.vMps === 0))
      break;
  }
  return log;
}

describe('field and meets (design 24.2, 24.3, 31.1)', () => {
  it('7 cohorts of 4 variants A-D with the design names; the same in every event', () => {
    expect(FIELD_SIZE).toBe(6);
    expect(fieldRunners(1)).toEqual([
      { tier: 1, body: 'fKid', variant: 'A', name: 'DOT' },
      { tier: 1, body: 'fKid', variant: 'B', name: 'MILO' },
      { tier: 1, body: 'fKid', variant: 'C', name: 'BEA' },
      { tier: 1, body: 'fKid', variant: 'D', name: 'NOOR' },
    ]);
    expect(fieldRunners(6).map((f) => f.name)).toEqual(['MK-2', 'MK-3', 'MK-4', 'MK-5']);
    expect(fieldRunners(7).map((f) => [f.body, f.name])).toEqual([
      ['fDrone', 'ZX-1'],
      ['fDrone', 'ZX-2'],
      ['fDrone', 'ZX-3'],
      ['fDrone', 'ZX-4'],
    ]);
    const bodies = [1, 2, 3, 4, 5, 6, 7].map((t) => fieldRunners(t)[0]?.body);
    expect(bodies).toEqual(['fKid', 'fTeen', 'fStudent', 'fClub', 'fElite', 'fBot', 'fDrone']);
    for (let t = 1; t <= 7; t++)
      for (const f of fieldRunners(t)) expect(f.name.length).toBeLessThanOrEqual(5);
    expect([1, 2, 3, 4, 5, 6, 7].map((t) => meet(t).name)).toEqual([
      'SPORTS DAY',
      'SCHOOL CHAMPS',
      'CAMPUS GAMES',
      'CITY OPEN',
      'WORLD GAMES',
      'NEON CUP',
      'GALACTIC MEET',
    ]);
    expect(() => fieldRunners(0)).toThrow();
    expect(() => meet(8)).toThrow();
  });
});

describe('6 runners and lanes (design 24.1, 24.4)', () => {
  it('player in lane 0, the named rival in lane 1, the tier cohort shuffled over lanes 2-5', () => {
    for (const event of ['100m', '110mh', '400m'] as const) {
      for (const { id, tier } of LADDERS[event]) {
        const st = new Race({ event, opponent: id, seed: 1234 + tier, startT: START_T }).state;
        expect(st.runners).toHaveLength(FIELD_SIZE);
        expect(st.runners.map((r) => r.lane)).toEqual([0, 1, 2, 3, 4, 5]);
        expect(st.runners[0]).toMatchObject({ who: { kind: 'player', id: 'rio' }, name: 'RIO' });
        expect(st.runners[1]).toMatchObject({ who: { kind: 'rival', id }, name: OPPONENTS[id].name });
        const names = st.runners.slice(2).map((r) => fieldName(r.who));
        expect([...names].sort()).toEqual(
          fieldRunners(tier)
            .map((f) => f.name)
            .sort(),
        );
        expect(st.player).toBe(st.runners[0]?.state);
        expect(st.rival).toBe(st.runners[1]?.state);
        expect(st.mode).toBe('l');
        expect(st.trip).toBe('none');
      }
    }
  });

  it('the lane shuffle is seeded: same seed same lanes, and every order shows up across seeds', () => {
    const order = (seed: number): string =>
      new Race({ event: '100m', opponent: 'pip', seed, startT: START_T }).state.runners
        .slice(2)
        .map((r) => fieldName(r.who))
        .join(',');
    expect(order(5)).toBe(order(5));
    const seen = new Set(Array.from({ length: 400 }, (_, i) => order(i)));
    expect(seen.size).toBe(24);
  });

  it('mode defaults to ladder and is carried to the outcome', () => {
    const { race } = runRace('pip', 3, (go) => alternate(go, 100, 400));
    expect(race.state.outcome?.mode).toBe('l');
    const g = new Race({ event: '100m', opponent: 'pip', seed: 3, startT: START_T, mode: 'g' });
    const go = runToGo(g);
    play(g, alternate(go, 100, 400), go, go + 30000);
    expect(g.state.mode).toBe('g');
    expect(g.state.outcome?.mode).toBe('g');
  });
});

describe('seeding (design 25.3)', () => {
  // Captured from the shipped v2 code (HEAD before v3) for these seeds: planRival(mulberry32(seed))
  // and the headless finish at the v2 V_TOP.
  const V2: readonly {
    event: EventId;
    opp: OpponentId;
    seed: number;
    v2VTop: number;
    vTop: number;
    at: number[];
    hurdles: string[];
    ms: number;
  }[] = [
    {
      event: '100m',
      opp: 'zyx',
      seed: 4410923,
      v2VTop: 10.158,
      vTop: 10.135347218082435,
      at: [31.627479671034962, 67.20094230072573, 52.913126919884235],
      hurdles: [],
      ms: 10421,
    },
    {
      event: '110mh',
      opp: 'pip',
      seed: 99120,
      v2VTop: 6.674,
      vTop: 6.726221480900357,
      at: [102.53653436666355],
      hurdles: ['clean', 'clean', 'hit', 'clip', 'clip', 'clip', 'hit', 'clip', 'clean', 'clean'],
      ms: 22251,
    },
    {
      event: '400m',
      opp: 'unit7',
      seed: 7,
      v2VTop: 8.002,
      vTop: 7.923853228694611,
      at: [91.23916515149176, 259.5381526555866, 303.98057411424816, 330.4289053706452],
      hurdles: [],
      ms: 52686,
    },
    {
      event: '100m',
      opp: 'pip',
      seed: 42,
      v2VTop: 6.383,
      vTop: 6.395906904970128,
      at: [44.68974335398525, 82.11479476094246],
      hurdles: [],
      ms: 17965,
    },
  ];

  it('a v2 seed reproduces the named rival bit-for-bit (same draws; same race at the v2 V_TOP)', () => {
    for (const g of V2) {
      const { ai } = createAi(g.event, g.opp, g.seed, { vTop: g.v2VTop });
      const rival = ai[0] as RivalSim;
      expect(rival.plan).toEqual({ vTop: g.vTop, at: g.at, hurdles: g.hurdles });
      expect(simulateRivalFinish(rival)).toBe(g.ms);
    }
  });

  it('inside a Race the field never touches the rival stream: lane 1 matches a lone RivalSim', () => {
    for (const [event, opp, seed] of [
      ['100m', 'kofi', 11],
      ['110mh', 'marco', 12],
      ['400m', 'sol', 13],
    ] as const) {
      const race = new Race({ event, opponent: opp, seed, startT: START_T });
      const lone = new RivalSim(event, opp, planRival(event, opp, mulberry32(seed)));
      const loneMs = simulateRivalFinish(lone);
      const go = runToGo(race);
      const log = runOut(race, go);
      expect(race.state.rival.finishMs).toBe(loneMs);
      expect(race.state.outcome?.oppMs).toBe(loneMs);
      expect(log.filter((e) => e.type === 'rivalFinish')).toEqual([{ type: 'rivalFinish', ms: loneMs }]);
    }
  });

  it('the field draws come from seed ^ FIELD_SEED_XOR in the design order', () => {
    const seed = 777;
    const rng = mulberry32((seed ^ TUNING.FIELD_SEED_XOR) >>> 0);
    const plan = planField('110mh', 1, rng);
    // Replay the draw order by hand: 3 shuffle draws, then m1, m2, switch, 10 hurdles per runner.
    const r = mulberry32((seed ^ 0x5bd1e995) >>> 0);
    const variants = ['A', 'B', 'C', 'D'];
    for (let i = 3; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [variants[i], variants[j]] = [variants[j] as string, variants[i] as string];
    }
    expect(plan.map((p) => p.info.variant)).toEqual(variants);
    for (const p of plan) {
      expect(p.m1).toBeCloseTo(0.9 + 0.1 * r(), 12);
      expect(p.m2).toBeCloseTo(0.9 + 0.1 * r(), 12);
      expect(p.switchM).toBeCloseTo(110 * (0.4 + 0.4 * r()), 9);
      const want = Array.from({ length: 10 }, () => {
        const d = r();
        return d < 0.03 ? 'hit' : d < 0.33 ? 'clip' : 'clean';
      });
      expect(p.hurdles).toEqual(want);
      expect(p.m1).toBeLessThanOrEqual(1);
      expect(p.m2).toBeLessThanOrEqual(1);
    }
    // No hurdle draws outside the hurdles.
    expect(planField('100m', 1, mulberry32(1)).every((p) => p.hurdles.length === 0)).toBe(true);
  });

  it('the same seed replays the same field (lanes, paces, hurdle outcomes); another seed differs', () => {
    const trace = (seed: number): string => {
      const { race, goWall } = startRace('110mh', 'pip', seed);
      const log = runOut(race, goWall);
      const st = race.state;
      return JSON.stringify([
        st.runners.map((r) => [fieldName(r.who), r.state.finishMs, r.state.hurdlesKnocked]),
        log.filter((e) => (laneOf(e) ?? 0) >= 2),
      ]);
    };
    expect(trace(31)).toBe(trace(31));
    expect(trace(31)).not.toBe(trace(32));
  });
});

describe('field AI (design 25.1)', () => {
  it('field runners announce no quirks, keep no effects and are always visible', () => {
    const { race, goWall } = startRace('100m', 'pip', 8);
    const log: RaceEvent[] = [];
    for (let k = 1; k * DT_MS < 30000; k++) {
      log.push(...race.advance(goWall + k * DT_MS));
      for (const r of race.state.runners.slice(2)) {
        expect(r.state.effect).toBe('none');
        expect(r.state.visible).toBe(true);
        expect(r.state.anim).not.toBe('stumble');
      }
    }
    const lone = new RivalSim('100m', 'pip', planRival('100m', 'pip', mulberry32(8)));
    const loneQuirks: RaceEvent[] = [];
    for (let k = 0; (lone.finishMs === null || lone.v > 0) && k < 120 * 60; k++) {
      const out: RaceEvent[] = [];
      lone.step((k * 1000) / 120, null, out);
      loneQuirks.push(...out.filter((e) => e.type === 'quirk'));
    }
    expect(log.filter((e) => e.type === 'quirk')).toEqual(loneQuirks);
  });

  it('cruise at V_FIELD x m1 before the switch point and x m2 after it; 400 m adds the profile', () => {
    const entry = planField('400m', 3, mulberry32(9))[0];
    if (entry === undefined) throw new Error('no field');
    const { spec, plan } = fieldSpecAndPlan('400m', 3, entry, 8);
    const sim = new RivalSim('400m', null, plan, spec, 2);
    let k = 0;
    const speedAt = (m: number): number => {
      while (sim.x < m && k < 120 * 120) sim.step((k++ * 1000) / 120, null, null);
      return sim.v;
    };
    // Long after the approach, speed sits on the target of the zone it is in.
    const sw = entry.switchM;
    if (sw > 190) {
      expect(speedAt(Math.min(sw - 1, 199))).toBeCloseTo(8 * entry.m1, 1);
    }
    expect(speedAt(299)).toBeCloseTo(8 * entry.m2 * 0.97, 1);
    expect(speedAt(399)).toBeCloseTo(8 * entry.m2 * 0.94, 1);
    expect(spec.reactionMs).toBe(220);
    expect(spec.tau).toBe(1.6);
  });

  it('hurdles: per-lane events with numeric lanes; outcomes follow the seeded draws, HIT included', () => {
    // Tier 1 has pHit 0.03: find a seed whose field has a HIT.
    let seed = 1;
    while (
      !planField('110mh', 1, mulberry32((seed ^ TUNING.FIELD_SEED_XOR) >>> 0)).some((f) =>
        f.hurdles.includes('hit'),
      )
    )
      seed++;
    const plan = planField('110mh', 1, mulberry32((seed ^ TUNING.FIELD_SEED_XOR) >>> 0));
    const { race, goWall } = startRace('110mh', 'pip', seed);
    const log = runOut(race, goWall);
    for (const f of plan) {
      const mine = log.filter((e) => laneOf(e) === f.lane && e.type.startsWith('hurdle'));
      expect(mine.map((e) => e.type)).toEqual(
        f.hurdles.map((h) => (h === 'hit' ? 'hurdleHit' : h === 'clip' ? 'hurdleClip' : 'hurdleClear')),
      );
      const jumps = log.filter((e) => laneOf(e) === f.lane && e.type === 'jump').length;
      expect(jumps).toBe(f.hurdles.filter((h) => h !== 'hit').length);
      const st = race.state.runners[f.lane]?.state;
      expect(st?.hurdlesKnocked).toEqual(f.hurdles.map((h) => h !== 'clean'));
    }
    for (const e of log) {
      const lane = laneOf(e);
      if (lane !== null) expect(Number.isInteger(lane) && lane >= 0 && lane <= 5).toBe(true);
    }
  });
});

describe('places, standings and outcome (design 24.1)', () => {
  it('rankStandings: ascending ms, ties share the better place, the player first among equals', () => {
    const who: LaneCharacter = { kind: 'player', id: 'rio' };
    const rows = [
      { lane: 3, who, name: 'C', ms: 12000 },
      { lane: 0, who, name: 'P', ms: 12000 },
      { lane: 1, who, name: 'R', ms: 11900 },
      { lane: 2, who, name: 'A', ms: 12100 },
      { lane: 4, who, name: 'D', ms: 12000 },
      { lane: 5, who, name: 'E', ms: 12500 },
    ];
    expect(rankStandings(rows).map((s) => [s.lane, s.place])).toEqual([
      [1, 1],
      [0, 2],
      [3, 2],
      [4, 2],
      [2, 5],
      [5, 6],
    ]);
  });

  it('a won race: all 6 times at the player crossing; on-screen runnerFinish times match them', () => {
    const { race, goWall } = startRace('100m', 'pip', 21);
    const log = drive(race, goWall, { rate: 12 });
    const o = race.state.outcome;
    expect(o).toMatchObject({ result: 'win', place: 1, fieldSize: 6 });
    expect(o?.winMs).toBe(o?.ms);
    expect(o?.standings).toHaveLength(6);
    expect(o?.standings[0]).toMatchObject({ lane: 0, place: 1, name: 'RIO' });
    expect(o?.standings.every((s) => s.ms !== null && s.place !== null)).toBe(true);
    const after = runOut(race, goWall + race.state.raceMs);
    const finishes = [...log, ...after].filter((e) => e.type === 'runnerFinish');
    expect(finishes).toHaveLength(6);
    for (const f of finishes) {
      if (f.type !== 'runnerFinish') continue;
      expect(o?.standings.find((s) => s.lane === f.lane)?.ms).toBe(f.ms);
    }
    // Run-out for everyone: all stop inside the 20 m run-out.
    for (const r of race.state.runners) {
      expect(r.state.vMps).toBe(0);
      expect(r.state.xM).toBeLessThanOrEqual(120 + 1e-9);
    }
  });

  it('result is win iff place 1; beating the named rival is not enough (design 23.1.2)', () => {
    for (let period = 100; period <= 135; period += 5) {
      const { race } = runRace('jess', 4, (go) => alternate(go, period, 400));
      const o = race.state.outcome;
      if (o === null || o.place === null) throw new Error('no place');
      expect(o.result).toBe(o.place === 1 ? 'win' : 'lose');
      expect(o.standings.find((s) => s.lane === 0)?.place).toBe(o.place);
    }
    // Found by scanning: the player beats Jess (14987 vs 15023) but the field runner in lane 3 wins.
    const o = runRace('jess', 3, (go) => alternate(go, 130, 400)).race.state.outcome;
    expect(o).toMatchObject({ result: 'lose', place: 2, ms: 14987, oppMs: 15023, winMs: 14973 });
    expect(o?.marginMs).toBe(-36);
    expect(o?.standings.map((s) => [s.lane, s.place])).toEqual([
      [3, 1],
      [0, 2],
      [1, 3],
      [2, 4],
      [4, 5],
      [5, 6],
    ]);
  });

  it('DNF: no place, the player listed last; AI places 1-5 from their simulated times', () => {
    const { race } = runRace('pip', 5, () => [], 31000);
    const o = race.state.outcome;
    expect(o).toMatchObject({ result: 'dnf', ms: null, place: null });
    expect(o?.standings.map((s) => s.place)).toEqual([1, 2, 3, 4, 5, null]);
    expect(o?.standings[5]).toMatchObject({ lane: 0, ms: null, place: null });
    expect(o?.winMs).toBe(o?.standings[0]?.ms);
    expect(race.state.livePlace).toBeNull();
  });

  it('DQ: no place and no times; the player listed last after the 5 AI in lane order', () => {
    const race = new Race({ event: '100m', opponent: 'pip', seed: 5, startT: START_T });
    const log: RaceEvent[] = [];
    for (let k = 1; k < 2000 && race.state.outcome === null; k++) {
      const now = START_T + k * DT_MS;
      if (race.state.phase === 'countdown') race.input({ kind: 'down', side: 'L', t: now, repeat: false });
      if (race.state.phase === 'countdown') race.input({ kind: 'up', side: 'L', t: now + 1, repeat: false });
      log.push(...race.advance(now + 2));
    }
    const o = race.state.outcome;
    expect(o).toMatchObject({ result: 'dq', place: null, winMs: null, oppMs: null });
    expect(o?.standings.map((s) => [s.lane, s.ms, s.place])).toEqual([
      [1, null, null],
      [2, null, null],
      [3, null, null],
      [4, null, null],
      [5, null, null],
      [0, null, null],
    ]);
    expect(race.state.livePlace).toBeNull();
  });
});

describe('live place, leader and v3 events (design 27.2, 31.3)', () => {
  it('livePlace is null before GO, follows true distance, and freezes at the final place', () => {
    const race = new Race({ event: '100m', opponent: 'kofi', seed: 2, startT: START_T });
    expect(race.state.livePlace).toBeNull();
    const log: RaceEvent[] = [];
    const go = runToGo(race, log);
    expect(race.state.livePlace).toBe(1);
    const states: RaceState[] = [];
    log.push(...drive(race, go, { rate: 9, onTick: (s) => states.push(s) }));
    const changes = log.filter((e) => e.type === 'placeChange');
    expect(changes[0]).toEqual({ type: 'placeChange', place: 1 });
    let checked = 0;
    for (const st of states) {
      if (st.player.finishMs !== null || st.runners.some((r) => r.state.finishMs !== null)) continue;
      // Rendered xM lags the sim by a tick; skip states where anyone is within 0.5 m of the player.
      const others = st.runners.slice(1);
      if (others.some((r) => Math.abs(r.state.xM - st.player.xM) < 0.5)) continue;
      expect(st.livePlace).toBe(1 + others.filter((r) => r.state.xM > st.player.xM).length);
      checked++;
    }
    expect(checked).toBeGreaterThan(200);
    const final = race.state.outcome?.place;
    expect(race.state.livePlace).toBe(final);
    expect(changes.at(-1)).toEqual({ type: 'placeChange', place: final });
    // Consecutive changes always differ.
    for (let i = 1; i < changes.length; i++) expect(changes[i]).not.toEqual(changes[i - 1]);
  });

  it('leaderLane is the furthest runner, then the first finisher', () => {
    const { race, goWall } = startRace('100m', 'zyx', 3);
    runOut(race, goWall, 3000);
    const st = race.state;
    const maxX = Math.max(...st.runners.map((r) => r.state.xM));
    expect(st.runners[st.leaderLane]?.state.xM).toBeCloseTo(maxX, 0);
    runOut(race, goWall + 3000);
    const o = race.state.outcome;
    const first = o?.standings[0];
    expect(race.state.leaderLane).toBe(first?.lane);
  });

  it('closeFinish fires once when the 1st-2nd margin is within 20 ms, never otherwise', () => {
    const close = runRace('kofi', 77, (go) => alternate(go, 106.54, 400)).log;
    expect(close.filter((e) => e.type === 'closeFinish')).toHaveLength(1);
    const { race, log } = runRace('pip', 21, (go) => alternate(go, 80, 400), 40000);
    const ms = (race.state.outcome?.standings ?? []).map((s) => s.ms ?? 0);
    expect((ms[1] ?? 0) - (ms[0] ?? 0)).toBeGreaterThan(TUNING.PHOTO_MARGIN_MS);
    expect(log.filter((e) => e.type === 'closeFinish')).toHaveLength(0);
  });

  it('result anims: the winner celebrates, others lose; Rio idles on 2nd-3rd, loses on 4th-6th', () => {
    const settle = (period: number): RaceState => {
      const { race, goWall } = startRace('100m', 'marco', 6);
      play(race, alternate(goWall, period, 400), goWall, goWall + 40000);
      return race.state;
    };
    for (const period of [70, 85, 100, 140]) {
      const st = settle(period);
      const o = st.outcome;
      if (o === null || o.place === null) throw new Error('no place');
      const want = o.place === 1 ? 'celebrate' : o.place <= 3 ? 'idle' : 'lose';
      expect(st.player.anim).toBe(want);
      for (const s of o.standings.filter((x) => x.lane !== 0)) {
        expect(st.runners[s.lane]?.state.anim).toBe(s.place === 1 ? 'celebrate' : 'lose');
      }
    }
  });
});
