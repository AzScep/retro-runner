import { describe, expect, it } from 'vitest';
import type { RaceEvent, RaceState, RunKeyEvent } from '../index.ts';
import { Race } from '../index.ts';
import { DT_MS } from '../clock/clock.ts';
import { alternate, down, play, runRace, runToGo, START_T, up } from './testkit.ts';

const types = (log: RaceEvent[]): string[] => log.map((e) => e.type);
const steps = (log: RaceEvent[]): number => log.filter((e) => e.type === 'step').length;
/** Advance in 60 Hz frames (single big jumps would hit the 250 ms catch-up cap). */
const frames = (race: Race, from: number, to: number): RaceEvent[] => play(race, [], from, to);

/** Independent reference of design 2.2/2.3/2.6 for a list of valid alternations (race ms). */
function referenceFinish(pressMs: readonly number[]): number {
  let v = 0;
  let x = 0;
  let last: number | null = null;
  let i = 0;
  for (let k = 0; k < 4000; k++) {
    const t0 = k * DT_MS;
    while (i < pressMs.length && Math.ceil((pressMs[i] as number) / DT_MS - 1e-9) <= k) {
      v = Math.min(12.5, v + 0.5);
      last = pressMs[i] as number;
      i++;
    }
    v -= 0.5 * v * (1 / 120);
    if (t0 - (last ?? 0) > 250) v = Math.max(0, v - 3 / 120);
    const xp = x;
    x += v / 120;
    if (x >= 100) return Math.round(t0 + (DT_MS * (100 - xp)) / (x - xp));
  }
  throw new Error('no finish');
}

describe('Race: countdown (design 2.5)', () => {
  it('walks in for 1.5 s, then beats 3/2/1 every 0.8 s, with a seeded 0-0.5 s extra on "1"', () => {
    const race = new Race({ event: '100m', opponent: 'pip', seed: 5, startT: START_T });
    expect(race.state.phase).toBe('intro');
    expect(race.state.player.anim).toBe('walk');
    expect(race.state.player.xM).toBeCloseTo(-4, 9);
    const at: Record<string, number> = {};
    for (let k = 1; k < 700; k++) {
      for (const e of race.advance(START_T + k * DT_MS)) {
        const key = e.type === 'beat' ? `beat${e.beat}` : e.type;
        at[key] ??= (k - 1) * DT_MS;
      }
      if (k === 200) {
        expect(race.state.countdown).toBe(3);
        expect(race.state.player.anim).toBe('ready1');
        expect(race.state.player.xM).toBe(0);
      }
    }
    expect(at.introDone).toBeCloseTo(1500, 6);
    expect(at.beat3).toBeCloseTo(1500, 6);
    expect(at.beat2).toBeCloseTo(2300, 6);
    expect(at.beat1).toBeCloseTo(3100, 6);
    expect(at.beatgo).toBeGreaterThanOrEqual(3900 - 1e-6);
    expect(at.beatgo).toBeLessThanOrEqual(4400 + 1e-6);
  });

  it('shows ready2 from "1" and GO text for 0.6 s; the timer reads 0 until GO', () => {
    const race = new Race({ event: '100m', opponent: 'pip', seed: 5, startT: START_T });
    frames(race, START_T, START_T + 3200);
    expect(race.state.countdown).toBe(1);
    expect(race.state.player.anim).toBe('ready2');
    expect(race.state.raceMs).toBe(0);
    expect(race.state.timerMs).toBe(0);
    const go = runToGo(race);
    frames(race, go, go + 500);
    expect(race.state.countdown).toBe('go');
    frames(race, go + 500, go + 700);
    expect(race.state.countdown).toBeNull();
    expect(race.state.raceMs).toBeCloseTo(700, 0);
  });

  it('the length of "1" varies with the seed', () => {
    const gos = new Set<number>();
    for (let seed = 1; seed <= 20; seed++)
      gos.add(runToGo(new Race({ event: '100m', opponent: 'pip', seed, startT: START_T })));
    expect(gos.size).toBeGreaterThan(10);
  });
});

describe('Race: false starts (design 2.5)', () => {
  it('first false start: banner, back to crouch, countdown restarts from 3', () => {
    const race = new Race({ event: '100m', opponent: 'jess', seed: 1, startT: START_T });
    frames(race, START_T, START_T + 2500); // during "2"
    race.input(down('L', START_T + 2500));
    const log = race.advance(START_T + 2520);
    expect(types(log)).toContain('falseStart');
    expect(race.state.phase).toBe('falseStart');
    expect(race.state.falseStarts).toBe(1);
    expect(race.state.player.anim).toBe('stumble');
    const later = frames(race, START_T + 2520, START_T + 2520 + 1500);
    expect(later).toContainEqual({ type: 'beat', beat: 3 });
    expect(race.state.phase).toBe('countdown');
    expect(race.state.player.anim).toBe('ready1');
  });

  it('second false start disqualifies: dq outcome, no time, no oppMs, resultReady after the banner', () => {
    const race = new Race({ event: '100m', opponent: 'jess', seed: 1, startT: START_T });
    frames(race, START_T, START_T + 2500);
    race.input(down('L', START_T + 2500));
    race.input(up('L', START_T + 2550));
    frames(race, START_T + 2500, START_T + 5000); // banner over, new countdown running
    race.input(down('R', START_T + 5000));
    const log = race.advance(START_T + 5020);
    expect(types(log)).toEqual(expect.arrayContaining(['falseStart', 'disqualified']));
    // The DISQUALIFIED banner holds for FALSE_START_BANNER_MS before the card (outcome final at once).
    expect(types(log)).not.toContain('resultReady');
    expect(race.state.outcome?.result).toBe('dq');
    expect(types(frames(race, START_T + 5020, START_T + 6400))).not.toContain('resultReady');
    expect(types(frames(race, START_T + 6400, START_T + 6600))).toContain('resultReady');
    const s = race.state;
    expect(s.phase).toBe('finished');
    expect(s.outcome).toMatchObject({ result: 'dq', ms: null, oppMs: null, marginMs: null, falseStarts: 2 });
    expect(s.player.anim).toBe('lose');
  });

  it('auto-repeat is never a false start: hold L with repeats through the countdown, then release and press', () => {
    const race = new Race({ event: '100m', opponent: 'jess', seed: 1, startT: START_T });
    race.input(down('L', START_T + 1000)); // pressed during the walk-in: not a false start
    // Auto-repeat every 30 ms from "3" until well after the latest possible GO.
    for (let t = START_T + 1500; t < START_T + 5600; t += 30) race.input(down('L', t, true));
    const log: RaceEvent[] = [];
    const goWall = runToGo(race, log);
    log.push(...play(race, [], goWall, START_T + 5600));
    expect(types(log)).not.toContain('falseStart');
    expect(steps(log)).toBe(0);
    expect(race.state.falseStarts).toBe(0);
    expect(race.state.phase).toBe('running');
    // Still held after GO: an L press from a second source (touch) cannot step.
    const go = START_T + 5600;
    expect(steps(play(race, [down('L', go + 10)], go, go + 50))).toBe(0);
    // Both sources must release before L steps again.
    expect(steps(play(race, [up('L', go + 55), down('L', go + 58)], go + 50, go + 59))).toBe(0);
    const log2 = play(race, [up('L', go + 60), up('L', go + 61), down('L', go + 100)], go + 59, go + 200);
    expect(log2).toContainEqual({ type: 'step', side: 'L' });
    expect(race.state.expectedSide).toBe('R');
  });

  it('a fresh keydown during the countdown is a false start', () => {
    const race = new Race({ event: '100m', opponent: 'jess', seed: 1, startT: START_T });
    const log = play(race, [down('R', START_T + 1800)], START_T, START_T + 1900);
    expect(log).toContainEqual({ type: 'falseStart', count: 1 });
  });

  it('holding a key through the countdown is not a false start, but it cannot step until re-pressed', () => {
    const race = new Race({ event: '100m', opponent: 'jess', seed: 1, startT: START_T });
    race.input(down('L', START_T + 1000));
    const go = runToGo(race);
    expect(race.state.falseStarts).toBe(0);
    // A second source pressing L while the first holds it gives nothing.
    const log = play(race, [down('L', go + 50), down('R', go + 100)], go, go + 200);
    expect(steps(log)).toBe(1); // only R; L is still held
    expect(race.state.expectedSide).toBe('L');
    const log2 = play(race, [up('L', go + 240), up('L', go + 250), down('L', go + 300)], go + 200, go + 400);
    expect(steps(log2)).toBe(1);
  });

  it('inputs before GO never become speed', () => {
    const race = new Race({ event: '100m', opponent: 'jess', seed: 1, startT: START_T });
    race.input(down('L', START_T + 100));
    race.input(up('L', START_T + 200));
    race.input(down('R', START_T + 300));
    race.input(up('R', START_T + 400));
    runToGo(race);
    expect(race.state.player.vMps).toBe(0);
    expect(race.state.expectedSide).toBeNull();
  });
});

describe('Race: mash model in the full loop', () => {
  it('10 alternations per second for the whole race finishes in about 12.0 s', () => {
    const { race } = runRace('kofi', 3, (go) => alternate(go, 100, 300));
    const ms = race.state.outcome?.ms ?? 0;
    expect(Math.abs(ms - 12000)).toBeLessThan(150);
  });

  it('the interpolated finish ms equals an independent reference for a synthetic press list', () => {
    const rel = Array.from({ length: 300 }, (_, i) => 3 + i * 87.3);
    const { race, goWall } = runRace('marco', 11, (go) =>
      rel.flatMap((r, i): RunKeyEvent[] => {
        const side = i % 2 === 0 ? 'L' : 'R';
        return [down(side, go + r), up(side, go + r + 20)];
      }),
    );
    expect(goWall).toBeGreaterThan(START_T);
    expect(race.state.outcome?.ms).toBe(referenceFinish(rel));
    expect(race.state.player.finishMs).toBe(race.state.outcome?.ms);
  });

  it('applies events by timestamp, not by frame: different frame chunking gives identical results', () => {
    const presses = (go: number): RunKeyEvent[] => alternate(go + 7.1, 91.7, 300, 23);
    const chunkings: (readonly number[])[] = [[1000 / 60], [1000 / 144], [33.4, 5, 16.7, 50, 2.2], [DT_MS]];
    const results = chunkings.map((frames) => {
      const { race, log } = runRace('valentina', 99, presses, 32000, frames);
      return { outcome: race.state.outcome, events: types(log).join(','), x: race.state.player.xM };
    });
    for (const r of results.slice(1)) expect(r).toEqual(results[0]);
  });

  it('is deterministic: same seed and presses give the same outcome; other seeds move the rival', () => {
    const presses = (go: number): RunKeyEvent[] => alternate(go, 95, 300);
    const a = runRace('zyx', 1234, presses).race.state.outcome;
    const b = runRace('zyx', 1234, presses).race.state.outcome;
    const c = runRace('zyx', 4321, presses).race.state.outcome;
    expect(a).toEqual(b);
    expect(c?.oppMs).not.toBe(a?.oppMs);
  });

  it('reports step and fumble events and the expected side', () => {
    const race = new Race({ event: '100m', opponent: 'pip', seed: 2, startT: START_T });
    const go = runToGo(race);
    expect(race.state.expectedSide).toBeNull();
    const log = play(
      race,
      [down('L', go + 10), up('L', go + 30), down('L', go + 100), up('L', go + 120)],
      go,
      go + 200,
    );
    expect(log.filter((e) => e.type === 'step' || e.type === 'fumble')).toEqual([
      { type: 'step', side: 'L' },
      { type: 'fumble', side: 'L' },
    ]);
    expect(race.state.expectedSide).toBe('R');
    expect(race.state.player.vMps).toBeLessThan(0.5);
  });

  it('holding one key after GO leaves the runner at 0 km/h', () => {
    const race = new Race({ event: '100m', opponent: 'pip', seed: 2, startT: START_T });
    const go = runToGo(race);
    const held = [
      down('R', go + 10),
      ...Array.from({ length: 150 }, (_, i) => down('R', go + 500 + i * 30, true)),
    ];
    play(race, held, go, go + 5000);
    expect(race.state.player.vMps).toBe(0);
    expect(race.state.idleMs).toBeGreaterThan(4900);
  });

  it('exposes runFps = clamp(2v, 6, 25) and ready2 below 0.3 m/s', () => {
    const race = new Race({ event: '100m', opponent: 'pip', seed: 2, startT: START_T });
    const go = runToGo(race);
    race.advance(go + 100);
    expect(race.state.player.anim).toBe('ready2');
    expect(race.state.player.runFps).toBe(6);
    play(race, alternate(go + 100, 80, 40), go + 100, go + 3300);
    const p = race.state.player;
    expect(p.anim).toBe('run');
    expect(p.runFps).toBeCloseTo(Math.min(25, Math.max(6, 2 * p.vMps)), 9);
  });
});

describe('Race: finish, run-out and results (design 1.4)', () => {
  it('player first: oppMs is exact (matches the later on-screen crossing) and resultReady comes 1.5 s after', () => {
    const race = new Race({ event: '100m', opponent: 'pip', seed: 8, startT: START_T });
    const go = runToGo(race);
    const log: (RaceEvent & { now: number })[] = [];
    const states: RaceState[] = [];
    const presses = alternate(go, 90, 400);
    let i = 0;
    for (let now = go; now < go + 25000; now += 1000 / 60) {
      while (i < presses.length && (presses[i]?.t ?? Infinity) <= now)
        race.input(presses[i++] as RunKeyEvent);
      const ev = race.advance(now);
      log.push(...ev.map((e) => ({ ...e, now })));
      states.push(race.state);
    }
    const pf = log.find((e) => e.type === 'playerFinish') as { ms: number; now: number };
    const ready = log.find((e) => e.type === 'resultReady') as { now: number };
    const rf = log.find((e) => e.type === 'rivalFinish') as { ms: number };
    const outcome = race.state.outcome;
    expect(outcome?.result).toBe('win');
    expect(outcome?.oppMs).toBe(rf.ms);
    expect(outcome?.marginMs).toBe(pf.ms - rf.ms);
    expect(ready.now - (go + pf.ms)).toBeGreaterThanOrEqual(1500 - 20);
    expect(ready.now - (go + pf.ms)).toBeLessThanOrEqual(1500 + 20);
    expect(types(log).indexOf('resultReady')).toBeLessThan(types(log).indexOf('rivalFinish'));
    // The HUD timer stops at the player's time.
    expect(race.state.timerMs).toBe(pf.ms);
    // Lean between 98 and 102 m, celebrate once settled; run-out bounded at 120 m.
    expect(states.some((s) => s.player.anim === 'lean')).toBe(true);
    expect(race.state.player.anim).toBe('celebrate');
    expect(race.state.rival.anim).toBe('lose');
    expect(Math.max(...states.map((s) => s.player.xM))).toBeLessThanOrEqual(120);
    expect(Math.max(...states.map((s) => s.rival.xM))).toBeLessThanOrEqual(120);
  });

  it('player input is ignored after crossing', () => {
    const { race, goWall } = runRace('pip', 8, (go) => alternate(go, 80, 140), 15000);
    const finish = race.state.player.finishMs ?? 0;
    const before = race.state.player.xM;
    const log = play(race, alternate(goWall + 15000, 60, 60), goWall + 15000, goWall + 20000);
    expect(finish).toBeGreaterThan(0);
    expect(steps(log)).toBe(0);
    expect(race.state.player.xM).toBeGreaterThanOrEqual(before);
    expect(race.state.player.vMps).toBe(0);
  });

  it('rival first: the race continues until the player crosses, result lose', () => {
    const { race, log } = runRace('valentina', 8, (go) => alternate(go, 120, 300));
    expect(types(log).indexOf('rivalFinish')).toBeLessThan(types(log).indexOf('playerFinish'));
    expect(race.state.outcome?.result).toBe('lose');
    expect(race.state.outcome?.marginMs).toBeGreaterThan(0);
  });

  it('DNF at 30 s: loss, no time, oppMs recorded, resultReady at once', () => {
    const { race, log, goWall } = runRace('pip', 4, () => [], 31000);
    const i = types(log).indexOf('dnf');
    expect(i).toBeGreaterThan(-1);
    expect(types(log)[i + 1]).toBe('resultReady');
    expect(race.state.outcome).toMatchObject({ result: 'dnf', ms: null, marginMs: null });
    expect(race.state.outcome?.oppMs).toBeGreaterThan(17000);
    expect(race.state.timerMs).toBe(30000);
    expect(race.state.player.anim).toBe('lose');
    expect(goWall).toBeGreaterThan(0);
  });

  it('a player crossing after the DNF records nothing', () => {
    // Slow mashing: about 3 alt/s reaches 100 m only after 30 s.
    const { race } = runRace('pip', 4, (go) => alternate(go, 330, 200), 40000);
    expect(race.state.outcome?.result).toBe('dnf');
    expect(race.state.player.finishMs).toBeNull();
  });

  it('a win by at most PHOTO_FINISH_MS (50 ms) is a photo finish; a wider win is not', () => {
    // Seed 77 vs Kofi: 106.54 ms presses tie Kofi at 12642; slightly faster presses win narrowly.
    for (const [period, photo] of [
      [106.3, true],
      [104, false],
    ] as const) {
      const o = runRace('kofi', 77, (go) => alternate(go, period, 400)).race.state.outcome;
      expect(o?.result).toBe('win');
      const second = o?.standings.find((r) => r.lane !== 0)?.ms ?? 0;
      const gap = second - (o?.ms ?? 0);
      expect(gap <= 50).toBe(photo);
      expect(o?.photoFinish).toBe(photo);
    }
  });

  it('a photo finish (equal ms with the winner) counts as a win and shares 1st (design 24.1)', () => {
    // Found by scanning press periods: the player and Kofi both cross at 12642 ms (seed 77).
    const { race } = runRace('kofi', 77, (go) => alternate(go, 106.54, 400));
    expect(race.state.outcome).toMatchObject({
      result: 'win',
      ms: 12642,
      oppMs: 12642,
      winMs: 12642,
      marginMs: 0,
      photoFinish: true,
      place: 1,
    });
    expect(race.state.outcome?.standings.slice(0, 3).map((s) => [s.lane, s.place])).toEqual([
      [0, 1],
      [1, 1],
      [5, 3],
    ]);
    // A dead heat with a field runner (seed 79): the player is listed first, both 1st, next is 3rd.
    const field = runRace('kofi', 79, (go) => alternate(go, 105.24, 400)).race.state.outcome;
    expect(field).toMatchObject({ result: 'win', ms: 12512, winMs: 12512, oppMs: 12754, photoFinish: true });
    expect(field?.standings.slice(0, 3).map((s) => [s.lane, s.ms, s.place])).toEqual([
      [0, 12512, 1],
      [4, 12512, 1],
      [1, 12754, 3],
    ]);
    // Slower presses: a loss without a photo finish.
    const slower = runRace('kofi', 77, (go) => alternate(go, 107, 400)).race.state.outcome;
    expect(slower?.result).toBe('lose');
    expect(slower?.place).toBeGreaterThanOrEqual(2);
    expect(slower?.photoFinish).toBe(false);
  });
});

describe('Race: immediate retry intro', () => {
  it('a short intro keeps the runners at the blocks, then the usual countdown', () => {
    const race = new Race({ event: '100m', opponent: 'pip', seed: 5, startT: START_T, introMs: 300 });
    expect(race.state.phase).toBe('intro');
    expect(race.state.player.xM).toBe(0);
    expect(race.state.player.anim).toBe('ready1');
    expect(race.state.rival.xM).toBe(0);
    const at: Record<string, number> = {};
    for (let k = 1; k < 500; k++)
      for (const e of race.advance(START_T + k * DT_MS)) {
        const key = e.type === 'beat' ? `beat${e.beat}` : e.type;
        at[key] ??= (k - 1) * DT_MS;
      }
    expect(at.introDone).toBeCloseTo(300, 6);
    expect(at.beat2).toBeCloseTo(1100, 6);
    expect(at.beat1).toBeCloseTo(1900, 6);
  });
});

describe('Race: pause and resume (design 8.4)', () => {
  it('pause freezes sim and clock; resume adds a frozen 0.5 s GET SET beat without a time jump', () => {
    const race = new Race({ event: '100m', opponent: 'kofi', seed: 6, startT: START_T });
    const go = runToGo(race);
    play(race, alternate(go, 100, 20), go, go + 2000);
    const s0 = race.state;
    race.pause(go + 2000);
    expect(race.state.paused).toBe(true);
    expect(race.advance(go + 9000)).toEqual([]);
    const s1 = race.state;
    expect(s1.raceMs).toBe(s0.raceMs);
    expect(s1.timerMs).toBe(s0.timerMs);
    expect(s1.rival.xM).toBe(s0.rival.xM);
    // Keys pressed while paused never count.
    race.input(down('R', go + 9500));
    race.input(up('R', go + 9550));
    race.resume(go + 10000);
    expect(race.state.paused).toBe(false);
    expect(race.state.getSet).toBe(true);
    race.input(down('R', go + 10200));
    race.input(up('R', go + 10250));
    const frozen = race.advance(go + 10400);
    expect(frozen).toEqual([]);
    expect(race.state.raceMs).toBe(s0.raceMs);
    expect(race.state.player.xM).toBe(s0.player.xM);
    race.advance(go + 10600);
    expect(race.state.getSet).toBe(false);
    expect(race.state.raceMs).toBeCloseTo(s0.raceMs + 100, -1);
  });

  it('a key held across pause must be released and re-pressed', () => {
    const race = new Race({ event: '100m', opponent: 'kofi', seed: 6, startT: START_T });
    const go = runToGo(race);
    play(race, [down('L', go + 10), up('L', go + 30), down('R', go + 100)], go, go + 200);
    race.pause(go + 200);
    race.resume(go + 1000);
    const log = play(race, [down('L', go + 1600), down('R', go + 1700)], go + 1000, go + 1800);
    expect(steps(log)).toBe(1);
    // R was pressed twice (two sources) without a release: both must lift before R steps.
    const log2 = play(
      race,
      [up('R', go + 1800), up('R', go + 1805), up('L', go + 1810), down('R', go + 1900)],
      go + 1800,
      go + 2000,
    );
    expect(steps(log2)).toBe(1);
  });

  it('pausing mid-frame keeps events produced up to the pause', () => {
    const race = new Race({ event: '100m', opponent: 'kofi', seed: 6, startT: START_T });
    frames(race, START_T, START_T + 1490);
    race.pause(START_T + 1600);
    expect(race.advance(START_T + 1700)).toContainEqual({ type: 'introDone' });
  });

  it('caps catch-up after a long stall instead of replaying it', () => {
    const race = new Race({ event: '100m', opponent: 'kofi', seed: 6, startT: START_T });
    const go = runToGo(race);
    const before = race.state.raceMs;
    race.advance(go + 5000);
    expect(race.state.raceMs - before).toBeCloseTo(250, 6);
  });
});

describe('Race: rival quirks surface as events and view state (design 3.3, 5.6)', () => {
  const expected: Record<string, string[]> = {
    pip: ['trip', 'wave'],
    jess: ['fade'],
    marco: ['coast'],
    kofi: ['kick'],
    valentina: ['kick', 'flashbulb'],
    unit7: ['overclock', 'overheat'],
    zyx: ['warpOut', 'warpIn', 'warpOut', 'warpIn', 'pressure'],
  };
  for (const [id, names] of Object.entries(expected)) {
    it(`${id}: ${names.join(', ')}`, () => {
      const race = new Race({
        event: '100m',
        opponent: id as RaceState['opponent'],
        seed: 21,
        startT: START_T,
      });
      const go = runToGo(race);
      // A capped-speed player, so Zyx feels the pressure.
      const presses = alternate(go, 60, 500);
      const log: RaceEvent[] = [];
      const seen = { stumble: false, invisible: false, wave: false, overclock: false, overheat: false };
      let i = 0;
      for (let now = go; now < go + 25000; now += 1000 / 60) {
        while (i < presses.length && (presses[i]?.t ?? Infinity) <= now)
          race.input(presses[i++] as RunKeyEvent);
        log.push(...race.advance(now));
        const r = race.state.rival;
        seen.stumble ||= r.anim === 'stumble';
        seen.invisible ||= !r.visible;
        seen.wave ||= r.effect === 'wave';
        seen.overclock ||= r.effect === 'overclock';
        seen.overheat ||= r.effect === 'overheat';
      }
      const got = log.flatMap((e) => (e.type === 'quirk' ? [e.name] : []));
      expect([...got].sort()).toEqual([...names].sort());
      expect(seen.stumble).toBe(id === 'pip');
      expect(seen.wave).toBe(id === 'pip');
      expect(seen.invisible).toBe(id === 'zyx');
      expect(seen.overclock && seen.overheat).toBe(id === 'unit7');
    });
  }
});
