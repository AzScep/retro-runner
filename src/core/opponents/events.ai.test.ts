import { describe, expect, it } from 'vitest';
import type { EventId, OpponentId, QuirkName, RaceEvent, RunnerEffect } from '../index.ts';
import { DT_MS } from '../clock/clock.ts';
import { hurdlePositions } from '../events.ts';
import { drive, play, startRace } from '../race/testkit.ts';
import { mulberry32 } from '../rng/mulberry32.ts';
import { planRival, RivalSim, type RivalPlan } from './ai.ts';
import { rivalSpec } from './specs.ts';

// Design 15.2-15.5: AI extensions per event.

const H = hurdlePositions('110mh');
const SEEDS = Array.from({ length: 1000 }, (_, i) => Math.imul(i + 1, 2654435761) >>> 0);

interface Sample {
  readonly x: number;
  readonly v: number;
  readonly effect: RunnerEffect;
  readonly visible: boolean;
  readonly tripping: boolean;
  readonly air: number | null;
}

function run(
  event: EventId,
  id: OpponentId,
  plan?: RivalPlan,
  playerX: ((ms: number) => number) | null = null,
): { events: RaceEvent[]; samples: Sample[]; sim: RivalSim } {
  const sim = new RivalSim(event, id, plan ?? planRival(event, id, mulberry32(42)));
  const events: RaceEvent[] = [];
  const samples: Sample[] = [];
  for (let k = 0; k < 120 * 90 && (sim.finishMs === null || sim.v > 0); k++) {
    const t0 = k * DT_MS;
    sim.step(t0, playerX === null ? null : playerX(t0), events);
    samples.push({
      x: sim.x,
      v: sim.v,
      effect: sim.effect,
      visible: sim.visible,
      tripping: sim.tripping,
      air: sim.airTicks,
    });
  }
  return { events, samples, sim };
}

const quirks = (events: RaceEvent[]): QuirkName[] =>
  events.flatMap((e) => (e.type === 'quirk' ? [e.name] : []));
const hurdleEvents = (events: RaceEvent[]): string[] =>
  events.flatMap((e) => (e.type.startsWith('hurdle') && 'index' in e ? [`${e.type}:${e.index}`] : []));
/** Exact plan from the spec's unshifted marks, a fixed V_TOP and given hurdle actions. */
function exact(event: EventId, id: OpponentId, hurdles?: RivalPlan['hurdles']): RivalPlan {
  const spec = rivalSpec(event, id);
  const base = planRival(event, id, () => 0.5); // 0.5: no V_TOP jitter, no mark shift
  return { vTop: spec.vTop, at: spec.marks.map((m) => m.at), hurdles: hurdles ?? base.hurdles };
}

describe('per-race plan (design 15.2, 15.4)', () => {
  it('distance marks jitter by +/-3 m in hurdles and +/-10 m in the 400 m; hurdle-anchored ones never', () => {
    for (const seed of SEEDS.slice(0, 200)) {
      const pip = planRival('110mh', 'pip', mulberry32(seed));
      expect(Math.abs((pip.at[0] ?? 0) - 100)).toBeLessThanOrEqual(3);
      const jess = planRival('110mh', 'jess', mulberry32(seed));
      expect(jess.at).toEqual([59.42]);
      const marco = planRival('110mh', 'marco', mulberry32(seed));
      expect(marco.at).toEqual([32, 50.28]);
      const zyx = planRival('110mh', 'zyx', mulberry32(seed));
      expect(zyx.at.slice(0, 2)).toEqual([(H[3] ?? 0) - 2.5, (H[7] ?? 0) - 2.5]);
      expect(Math.abs((zyx.at[2] ?? 0) - 55)).toBeLessThanOrEqual(3);
      const unit = planRival('400m', 'unit7', mulberry32(seed));
      [100, 250, 300, 330].forEach((d, i) => expect(Math.abs((unit.at[i] ?? 0) - d)).toBeLessThanOrEqual(10));
      expect(planRival('400m', 'sol', mulberry32(seed)).at).toEqual([100, 200, 300]);
    }
    const spread = SEEDS.slice(0, 200).map((s) => planRival('400m', 'zyx', mulberry32(s)).at[0] ?? 0);
    expect(Math.max(...spread) - Math.min(...spread)).toBeGreaterThan(15);
  });

  it('draws one seeded clip per hurdle with pClip; scripts override; same seed, same plan', () => {
    const clipRate = (id: OpponentId, i: number): number =>
      SEEDS.filter((s) => planRival('110mh', id, mulberry32(s)).hurdles[i] === 'clip').length / SEEDS.length;
    expect(clipRate('pip', 0)).toBeCloseTo(0.3, 1);
    expect(clipRate('marco', 4)).toBeCloseTo(0.25, 1);
    expect(clipRate('kofi', 9)).toBeCloseTo(0.1, 1);
    for (const s of SEEDS.slice(0, 100)) {
      const pip = planRival('110mh', 'pip', mulberry32(s)).hurdles;
      expect([pip[2], pip[6]]).toEqual(['hit', 'hit']);
      expect(planRival('110mh', 'valentina', mulberry32(s)).hurdles).toEqual(Array(10).fill('clean'));
      const unit = planRival('110mh', 'unit7', mulberry32(s)).hurdles;
      expect(unit).toEqual(Array.from({ length: 10 }, (_, i) => (i === 8 ? 'clip' : 'clean')));
      const zyx = planRival('110mh', 'zyx', mulberry32(s)).hurdles;
      expect(zyx).toEqual(Array.from({ length: 10 }, (_, i) => (i === 3 || i === 7 ? 'warp' : 'clean')));
    }
    expect(planRival('110mh', 'pip', mulberry32(5))).toEqual(planRival('110mh', 'pip', mulberry32(5)));
    expect(planRival('100m', 'pip', mulberry32(5)).hurdles).toEqual([]);
  });

  it('rejects rivals that do not race an event', () => {
    expect(() => planRival('100m', 'sol', mulberry32(1))).toThrow();
    expect(() => planRival('400m', 'valentina', mulberry32(1))).toThrow();
  });
});

describe('AI jumps (design 15.2)', () => {
  it('clean: takes off at (h - x) / v <= 0.5 x JUMP_AIR, crosses near the peak, lands with landKeep', () => {
    const { events, samples, sim } = run('110mh', 'valentina', exact('110mh', 'valentina'));
    expect(hurdleEvents(events)).toEqual(H.map((_, i) => `hurdleClear:${i}`));
    expect(events.filter((e) => e.type === 'jump')).toHaveLength(10);
    expect(events.filter((e) => e.type === 'land')).toHaveLength(10);
    expect(events.every((e) => !('lane' in e) || e.lane === 'rival')).toBe(true);
    expect(sim.knocked.every((k) => !k)).toBe(true);
    // At the H1 crossing the arc is in the middle (s ~ 0.48-0.5).
    const cross = samples.findIndex((s) => s.x >= (H[0] ?? 0));
    const prev = samples[cross - 1] as Sample;
    expect(prev.air).not.toBeNull();
    expect((prev.air ?? 0) / 48).toBeGreaterThan(0.44);
    expect((prev.air ?? 0) / 48).toBeLessThan(0.52);
    // Speed is frozen in the air and drops 6% on landing.
    const air = samples.filter((s) => s.air !== null);
    const firstAir = samples.findIndex((s) => s.air !== null);
    const vAir = samples[firstAir]?.v ?? 0;
    expect(air.slice(0, 47).every((s) => s.v === vAir)).toBe(true);
    expect(samples[firstAir + 47]?.v).toBeCloseTo(vAir * 0.94, 9);
  });

  it('clip: takeoff at 0.8 x JUMP_AIR produces CLIP by the arc (v x0.80, knocked)', () => {
    const plan = exact('110mh', 'kofi', Array(10).fill('clip'));
    const { events, sim } = run('110mh', 'kofi', plan);
    expect(hurdleEvents(events)).toEqual(H.map((_, i) => `hurdleClip:${i}`));
    expect(sim.knocked.every(Boolean)).toBe(true);
  });

  it('Pip: scripted HITs at H3 and H7 (no takeoff, x0.40, then x0.30 for 0.30 s with stumble)', () => {
    const plan = exact(
      '110mh',
      'pip',
      Array.from({ length: 10 }, (_, i) => (i === 2 || i === 6 ? 'hit' : 'clean')),
    );
    const { events, samples } = run('110mh', 'pip', plan);
    expect(hurdleEvents(events).filter((e) => e.startsWith('hurdleHit'))).toEqual([
      'hurdleHit:2',
      'hurdleHit:6',
    ]);
    expect(events.filter((e) => e.type === 'jump')).toHaveLength(8);
    expect(samples.filter((s) => s.tripping)).toHaveLength(2 * 36);
    const i = samples.findIndex((s) => s.x >= (H[2] ?? 0));
    expect(samples[i]?.v).toBeCloseTo((samples[i - 1]?.v ?? 0) * (1 - 1 / 120 / 1.5) * 0.4, 1);
    expect(quirks(events)).toEqual(['wave']);
  });

  it('UNIT-7: piston landings keep all speed; scripted CLIP at H9', () => {
    const { events, samples, sim } = run('110mh', 'unit7', exact('110mh', 'unit7'));
    expect(hurdleEvents(events).filter((e) => !e.startsWith('hurdleClear'))).toEqual(['hurdleClip:8']);
    expect(sim.knocked).toEqual(Array.from({ length: 10 }, (_, i) => i === 8));
    const firstAir = samples.findIndex((s) => s.air !== null);
    expect(samples[firstAir + 47]?.v).toBe(samples[firstAir]?.v);
    expect(quirks(events)).toEqual(['overclock', 'overheat']);
  });

  it('Zyx warps through H4 and H8: vanish at h - 2.5 m for 0.25 s, reappear at h + 2.5 m, hurdle standing', () => {
    const { events, samples, sim } = run('110mh', 'zyx', exact('110mh', 'zyx'));
    expect(quirks(events)).toEqual(['warpOut', 'warpIn', 'warpOut', 'warpIn']);
    expect(hurdleEvents(events)).toEqual(
      H.flatMap((_, i) => (i === 3 || i === 7 ? [] : [`hurdleClear:${i}`])),
    );
    expect(sim.knocked.every((k) => !k)).toBe(true);
    expect(samples.filter((s) => !s.visible)).toHaveLength(60);
    // The tick that reaches the mark already hides him; 30 ticks later he is back 5 m on.
    const out = samples.findIndex((s) => !s.visible);
    const back = (samples[out] as Sample).x;
    expect(back).toBeGreaterThanOrEqual((H[3] ?? 0) - 2.5);
    expect(back).toBeLessThan((H[3] ?? 0) - 2.4);
    expect(samples[out + 29]?.x).toBe(back);
    expect(samples[out + 30]?.visible).toBe(true);
    expect((samples[out + 30]?.x ?? 0) - back).toBeCloseTo(5, 9);
    expect(events.filter((e) => e.type === 'jump')).toHaveLength(8);
  });
});

describe('400 m rivals (design 15.4, 15.5)', () => {
  it('Pip sprints at x1.40, gasses out from ~60 m (sweat) and fades before 100 m; waves at 380 m', () => {
    const { events, samples } = run('400m', 'pip', exact('400m', 'pip'));
    expect(quirks(events)).toEqual(['sweat', 'wave']);
    const vAt = (x: number): number => samples.find((s) => s.x >= x)?.v ?? 0;
    expect(vAt(55)).toBeGreaterThan(6.572 * 1.25);
    expect(vAt(99)).toBeLessThan(vAt(55) * 0.75);
    expect(samples.find((s) => s.x >= 61)?.effect).toBe('sweat');
    expect(samples.find((s) => s.x >= 59)?.effect).toBe('none');
    expect(samples.find((s) => s.x >= 381)?.effect).toBe('wave');
    expect(samples.find((s) => s.x >= 395)?.effect).toBe('sweat');
  });

  it('Sol glances at his watch at 100, 200 and 300 m (0.5 s, no speed effect) and runs even splits', () => {
    const watched = run('400m', 'sol', exact('400m', 'sol'));
    expect(quirks(watched.events)).toEqual(['watch', 'watch', 'watch']);
    expect(watched.samples.filter((s) => s.effect === 'watch')).toHaveLength(3 * 60);
    const noWatch: RivalPlan = { ...exact('400m', 'sol'), at: [1000, 1000, 1000] };
    expect(run('400m', 'sol', noWatch).sim.finishMs).toBe(watched.sim.finishMs);
    // Splits per 100 m after the start: within 0.3 s of each other.
    const t = [100, 200, 300, 400].map((d) => watched.samples.findIndex((s) => s.x >= d) * DT_MS);
    const laps = [t[1]! - t[0]!, t[2]! - t[1]!, t[3]! - t[2]!];
    expect(Math.max(...laps) - Math.min(...laps)).toBeLessThan(300);
  });

  it('Zyx warps 10 m at ~150 m and ~330 m', () => {
    const { events, samples } = run('400m', 'zyx', exact('400m', 'zyx'));
    expect(quirks(events)).toEqual(['warpOut', 'warpIn', 'warpOut', 'warpIn']);
    const out = samples.findIndex((s) => !s.visible);
    expect(samples[out]?.x).toBeGreaterThanOrEqual(150);
    expect((samples[out + 30]?.x ?? 0) - (samples[out]?.x ?? 0)).toBeCloseTo(10, 9);
  });

  it('UNIT-7 overclocks 100-250 m (glow) and overheats 300-330 m (sparks)', () => {
    const { events, samples } = run('400m', 'unit7', exact('400m', 'unit7'));
    expect(quirks(events)).toEqual(['overclock', 'overheat']);
    expect(samples.find((s) => s.x >= 200)?.effect).toBe('overclock');
    expect(samples.find((s) => s.x >= 270)?.effect).toBe('none');
    expect(samples.find((s) => s.x >= 320)?.effect).toBe('overheat');
    expect(samples.find((s) => s.x >= 340)?.effect).toBe('none');
  });
});

describe('Zyx pressure thresholds per event (design 15.3, 15.4)', () => {
  const pressured = (event: EventId, lead: number, fromM: number): boolean => {
    const plan = exact(event, 'zyx');
    // A player who stays exactly `lead` metres ahead once Zyx has passed fromM.
    let zx = 0;
    const sim = new RivalSim(event, 'zyx', plan);
    const events: RaceEvent[] = [];
    for (let k = 0; k < 120 * 80 && sim.finishMs === null; k++) {
      zx = sim.x;
      sim.step(k * DT_MS, zx > fromM ? zx + lead : 0, events);
    }
    return quirks(events).includes('pressure');
  };
  it('hurdles: after 55 m, a lead over 1.5 m', () => {
    expect(pressured('110mh', 1.6, 56)).toBe(true);
    expect(pressured('110mh', 1.4, 56)).toBe(false);
    expect(pressured('110mh', 5, 0) && !pressured('110mh', 1.6, 200)).toBe(true);
  });
  it('400 m: after 200 m, a lead over 3.0 m', () => {
    expect(pressured('400m', 3.1, 201)).toBe(true);
    expect(pressured('400m', 2.9, 201)).toBe(false);
  });
});

describe('rival quirks through the Race, per event', () => {
  const expected: Record<'110mh' | '400m', Partial<Record<OpponentId, QuirkName[]>>> = {
    '110mh': {
      pip: ['wave'],
      jess: ['fade'],
      marco: ['coast'],
      kofi: ['kick'],
      valentina: ['kick', 'flashbulb'],
      unit7: ['overclock', 'overheat'],
      zyx: ['warpOut', 'warpIn', 'warpOut', 'warpIn', 'pressure'],
    },
    '400m': {
      pip: ['sweat', 'wave'],
      jess: ['fade'],
      marco: ['coast', 'kick'],
      kofi: ['kick'],
      sol: ['watch', 'watch', 'watch'],
      unit7: ['overclock', 'overheat'],
      zyx: ['warpOut', 'warpIn', 'warpOut', 'warpIn', 'pressure'],
    },
  };
  for (const event of ['110mh', '400m'] as const) {
    for (const [id, names] of Object.entries(expected[event])) {
      it(`${event} ${id}: ${names.join(', ')}`, () => {
        const { race, goWall } = startRace(event, id as OpponentId, 21);
        // A strong player (capped with clean jumps; 400 m: the optimal even pace) so Zyx feels the pressure.
        const rate = event === '110mh' ? 16 : 8.25;
        const log = drive(race, goWall, { rate, jumpS: event === '110mh' ? 0.2 : null });
        // The rival keeps running on screen after the player's finish.
        const end = goWall + race.state.raceMs;
        log.push(...play(race, [], end, end + 40000));
        expect(race.state.rival.finishMs).not.toBeNull();
        const got = log.flatMap((e) => (e.type === 'quirk' ? [e.name] : []));
        // Pressure re-engages each time the player retakes the lead; count it once.
        const once = (l: QuirkName[]): QuirkName[] => [...new Set(l.filter((n) => n === 'pressure'))];
        const rest = (l: QuirkName[]): QuirkName[] => l.filter((n) => n !== 'pressure').sort();
        expect(rest(got)).toEqual(rest(names));
        expect(once(got)).toEqual(once(names));
      });
    }
  }
});
