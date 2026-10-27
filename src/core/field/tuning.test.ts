import { describe, expect, it } from 'vitest';
import { EVENT_IDS, LADDERS, TUNING } from '../index.ts';
import { sweep } from './sweep.ts';

// Design 25.4-25.5 / acceptance 38: over 1000 seeded races with no player (pressure excluded), the
// median winning time of the 5 AI runners is the tier target +/-0.05 s, the named rival wins
// 60-75% of races, and no single field run beats the field floor. p10, p90 and the rest are
// reported. Replaces the v2 rival-mean test.

const fmt = (ms: number): string => (ms / 1000).toFixed(2);

for (const event of EVENT_IDS) {
  describe(`field tuning, ${event} (headless, 1000 seeded races per tier)`, () => {
    for (const { id, tier, targetMs } of LADDERS[event]) {
      // 5000 runner simulations per tier: generous timeout for the 400 m on a loaded machine.
      it(
        `tier ${tier} (${id}): median win ${targetMs} ms +/- 50, rival share 0.60-0.75, field floor`,
        {
          timeout: 120000,
        },
        () => {
          const st = sweep(event, tier);
          const floorMs = targetMs * (1 - TUNING.FIELD_FLOOR_PCT[event]);
          console.info(
            `${event} T${tier} ${id}: median ${fmt(st.medianWin)} p10 ${fmt(st.p10Win)} p90 ${fmt(st.p90Win)}` +
              ` rival ${st.rivalShare.toFixed(3)} mean ${fmt(st.rivalMean)} fastest field ${fmt(st.fastestField)}` +
              ` (floor ${fmt(floorMs)}) lanes ${st.laneShare.map((s) => s.toFixed(3)).join(' ')}`,
          );
          expect(Math.abs(st.medianWin - targetMs)).toBeLessThanOrEqual(TUNING.WIN_MEDIAN_TOL_MS);
          expect(st.rivalShare).toBeGreaterThanOrEqual(TUNING.RIVAL_WIN_SHARE_LO);
          expect(st.rivalShare).toBeLessThanOrEqual(TUNING.RIVAL_WIN_SHARE_HI);
          expect(st.fastestField).toBeGreaterThanOrEqual(floorMs);
          expect(st.p10Win).toBeLessThanOrEqual(st.medianWin);
          expect(st.p90Win).toBeGreaterThanOrEqual(st.medianWin);
          // Design 25.5 report row: no lane bias from the shuffle.
          for (const share of st.laneShare) {
            expect(share).toBeGreaterThanOrEqual(0.04);
            expect(share).toBeLessThanOrEqual(0.12);
          }
        },
      );
    }
  });
}
