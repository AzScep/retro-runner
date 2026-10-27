/**
 * Headless trip simulation (question 2). Run with plain node (type stripping):
 *   node tools/prototype/trip-sim.ts [races per cell, default 4000]
 *
 * Simulated human: reacts 150-200 ms after GO, then presses at `rate` alternations per second with
 * Gaussian timing jitter (sd 12 % of the interval). Each press is a same-side error with probability
 * `err` (independent), or in the "bursty" model the next 3 presses after an error err at 25 %
 * (losing the rhythm). Every rule sees the same press stream for a given seed (paired comparison).
 */
import type { Side } from '../../src/core/index.ts';
import { DEFAULT_TRIP, TripRace, type TripParams } from './tripModel.ts';

const N = Number(process.argv[2] ?? 4000);

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(r: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
}

interface Human {
  readonly rate: number;
  readonly err: number;
  readonly bursty: boolean;
}

interface RaceOut {
  readonly ms: number;
  readonly trips: number;
  readonly fumbles: number;
}

function race(p: TripParams, h: Human, seed: number): RaceOut {
  const r = rng(seed);
  const tr = new TripRace(p);
  let t = 150 + r() * 50;
  let burst = 0;
  let side: Side = 'L';
  while (!tr.finished && t < 30000) {
    tr.advanceTo(t);
    if (tr.finished) break;
    const pErr = burst > 0 ? 0.25 : h.err;
    const error = r() < pErr;
    if (burst > 0) burst -= 1;
    if (error && h.bursty) burst = 3;
    // A correct press goes to the side the race expects; an error repeats the last valid side.
    const last = tr.filter.lastSide;
    side = last === null ? (side === 'L' ? 'R' : 'L') : error ? last : last === 'L' ? 'R' : 'L';
    tr.press(side, t);
    tr.release(side);
    const iv = 1000 / h.rate;
    t += Math.max(30, iv * (1 + 0.12 * gauss(r)));
  }
  tr.advanceTo(30000);
  return { ms: tr.body.finishMs ?? 30000, trips: tr.trips, fumbles: tr.fumbles };
}

function pct(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] as number;
}

const s = (ms: number) => (ms / 1000).toFixed(2);

interface Variant {
  readonly name: string;
  readonly p: TripParams;
}

const VARIANTS: readonly Variant[] = [
  { name: 'A today', p: { ...DEFAULT_TRIP, rule: 'A' } },
  { name: 'B W.5 L.4', p: DEFAULT_TRIP },
  { name: 'B W.25 keep30', p: { ...DEFAULT_TRIP, windowS: 0.25, speedLoss: 0.7 } },
  { name: 'B1 W.5', p: { ...DEFAULT_TRIP, rule: 'B1' } },
  { name: 'C W.5', p: { ...DEFAULT_TRIP, rule: 'C' } },
  { name: 'C W.5 keep30', p: { ...DEFAULT_TRIP, rule: 'C', speedLoss: 0.7 } },
];

const HUMANS: Human[] = [];
for (const bursty of [false, true]) {
  for (const rate of [8, 10, 12]) {
    for (const err of [0, 0.02, 0.05, 0.1]) {
      if (bursty && err === 0) continue;
      HUMANS.push({ rate, err, bursty });
    }
  }
}

console.log(`races per cell: ${N}; times in s; lost = mean extra time vs rule A on the same press stream`);
console.log(
  [
    'model',
    'alt/s',
    'err',
    'rule',
    'p10',
    'median',
    'p90',
    'trips/race',
    'races>=1 trip',
    'lost/race',
    'lost/trip',
  ]
    .map((x) => x.padEnd(14))
    .join(''),
);
for (const h of HUMANS) {
  const base: RaceOut[] = [];
  for (let i = 0; i < N; i++) base.push(race(VARIANTS[0]!.p, h, 1000 + i));
  for (const v of VARIANTS) {
    if (h.err === 0 && v !== VARIANTS[0]) continue;
    const outs = v === VARIANTS[0] ? base : Array.from({ length: N }, (_, i) => race(v.p, h, 1000 + i));
    const times = outs.map((o) => o.ms).sort((a, b) => a - b);
    const trips = outs.reduce((a, o) => a + o.trips, 0);
    const anyTrip = outs.filter((o) => o.trips > 0).length;
    const lost = outs.reduce((a, o, i) => a + (o.ms - (base[i] as RaceOut).ms), 0);
    console.log(
      [
        h.bursty ? 'bursty' : 'indep',
        String(h.rate),
        `${(h.err * 100).toFixed(0)}%`,
        v.name,
        s(pct(times, 0.1)),
        s(pct(times, 0.5)),
        s(pct(times, 0.9)),
        (trips / N).toFixed(2),
        `${((100 * anyTrip) / N).toFixed(1)}%`,
        s(lost / N),
        trips ? s(lost / trips) : '-',
      ]
        .map((x) => x.padEnd(14))
        .join(''),
    );
  }
}
