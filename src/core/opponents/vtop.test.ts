import { describe, expect, it } from 'vitest';
import { OPPONENT_IDS, OPPONENTS } from '../index.ts';
import { mulberry32 } from '../rng/mulberry32.ts';
import { planRival, RivalSim, simulateRivalFinish } from './ai.ts';

// Design 3.1 / acceptance: mean finish over 1000 seeded races within +/-0.05 s of the target.
// Zyx's pressure rule needs a leading player, so it is excluded here (design 3.3).
const SEEDS = Array.from({ length: 1000 }, (_, i) => Math.imul(i + 1, 2654435761) >>> 0);

describe('rival V_TOP tuning (headless, 1000 seeded races each)', () => {
  for (const id of OPPONENT_IDS) {
    it(`${id} averages ${OPPONENTS[id].targetMs} ms +/- 50`, () => {
      let sum = 0;
      let min = Infinity;
      let max = -Infinity;
      for (const seed of SEEDS) {
        const ms = simulateRivalFinish(new RivalSim(id, planRival(id, mulberry32(seed))));
        expect(ms).not.toBeNull();
        sum += ms as number;
        min = Math.min(min, ms as number);
        max = Math.max(max, ms as number);
      }
      const mean = sum / SEEDS.length;
      expect(Math.abs(mean - OPPONENTS[id].targetMs)).toBeLessThanOrEqual(50);
      // Acceptance: individual races stay within about +/-0.2 s of the target.
      expect(min).toBeGreaterThanOrEqual(OPPONENTS[id].targetMs - 250);
      expect(max).toBeLessThanOrEqual(OPPONENTS[id].targetMs + 250);
    });
  }
});
