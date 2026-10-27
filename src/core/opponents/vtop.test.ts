import { describe, expect, it } from 'vitest';
import { EVENT_IDS, LADDERS } from '../index.ts';
import { mulberry32 } from '../rng/mulberry32.ts';
import { planRival, RivalSim, simulateRivalFinish } from './ai.ts';

// Design 3.1 / 15.2 / acceptance: mean finish over 1000 seeded races within +/-0.05 s of the target,
// per rival and event. Zyx's pressure rule needs a leading player, so it is excluded here.
const SEEDS = Array.from({ length: 1000 }, (_, i) => Math.imul(i + 1, 2654435761) >>> 0);

for (const event of EVENT_IDS) {
  describe(`rival V_TOP tuning, ${event} (headless, 1000 seeded races each)`, () => {
    for (const { id, targetMs } of LADDERS[event]) {
      // 1000 full races per rival: generous timeout for the 90 s 400 m runs on a loaded machine.
      it(`${id} averages ${targetMs} ms +/- 50`, { timeout: 60000 }, () => {
        let sum = 0;
        let min = Infinity;
        let max = -Infinity;
        for (const seed of SEEDS) {
          const ms = simulateRivalFinish(new RivalSim(event, id, planRival(event, id, mulberry32(seed))));
          expect(ms).not.toBeNull();
          sum += ms as number;
          min = Math.min(min, ms as number);
          max = Math.max(max, ms as number);
        }
        const mean = sum / SEEDS.length;
        expect(Math.abs(mean - targetMs)).toBeLessThanOrEqual(50);
        if (event === '100m') {
          // Acceptance (10): individual 100 m races stay within about +/-0.2 s of the target.
          expect(min).toBeGreaterThanOrEqual(targetMs - 250);
          expect(max).toBeLessThanOrEqual(targetMs + 250);
        }
      });
    }
  });
}
