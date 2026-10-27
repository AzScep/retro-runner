import { describe, expect, it } from 'vitest';
import type { RaceOutcome } from '../core/index.ts';
import { furthestText, gauntletAfterRace, gauntletStrip, newGauntletRun } from './gauntlet.ts';
import { bubbleBox, offscreenIndicators, PlaceHold } from './hudMath.ts';
import { miniTextWidth } from './miniFont.ts';
import { lastCell, RECORDS_COLUMNS } from './recordsLayout.ts';
import { bubbleAt, revealTimeline, skyStepAt } from './reveal.ts';

describe('live position hold (design 27.2)', () => {
  it('shows the first place at GO, then a new place only after it held 0.35 s', () => {
    const h = new PlaceHold(350);
    expect(h.update(null, 0, false)).toBeNull();
    expect(h.update(4, 100, false)).toBe(4);
    expect(h.update(3, 200, false)).toBe(4);
    expect(h.update(3, 500, false)).toBe(4);
    expect(h.update(3, 550, false)).toBe(3);
  });

  it('never flickers between level runners', () => {
    const h = new PlaceHold(350);
    h.update(2, 0, false);
    // Swapping every frame for a second: the label never changes.
    for (let t = 16; t < 1000; t += 16) expect(h.update(t % 32 === 0 ? 2 : 3, t, false)).toBe(2);
  });

  it('freezes at the crossing and hides on DQ', () => {
    const h = new PlaceHold(350);
    h.update(3, 0, false);
    expect(h.update(2, 10, true)).toBe(2);
    expect(h.update(5, 2000, true)).toBe(2);
    const dq = new PlaceHold(350);
    dq.update(1, 0, false);
    expect(dq.update(null, 10, false)).toBeNull();
  });
});

describe('off-screen indicators (design 27.4)', () => {
  const r = (lane: number, screenX: number, xM: number) => ({ lane, screenX, xM, visible: true });
  it('points at an off-screen leader with the true gap', () => {
    const ind = offscreenIndicators([r(0, 96, 50), r(1, 330, 54.2), r(2, 200, 52)], 1, 320);
    expect(ind.leader).toEqual({ lane: 1, gapM: expect.closeTo(4.2, 5) });
    expect(ind.behind).toBeNull();
  });
  it('counts the pack behind and flags the rival among them', () => {
    const ind = offscreenIndicators([r(0, 96, 50), r(1, -20, 40), r(2, -5, 41), r(3, 10, 44)], 0, 320);
    expect(ind.leader).toBeNull();
    expect(ind.behind).toEqual({ count: 2, rival: true });
  });
  it('shows no leader arrow while the leader is on screen or is the player', () => {
    expect(offscreenIndicators([r(0, 96, 50), r(2, 300, 60)], 2, 320).leader).toBeNull();
    expect(offscreenIndicators([r(0, 96, 50), r(2, 30, 40)], 0, 320).leader).toBeNull();
  });
});

describe('speech bubble placement (design 31.2)', () => {
  it('sits above the anchor with the tail under it, clamped on screen', () => {
    const b = bubbleBox('SET', 150, 60);
    expect(b.y + b.h + 3).toBeLessThanOrEqual(60);
    expect(b.tailX).toBeGreaterThanOrEqual(b.x);
    expect(b.tailX + 3).toBeLessThanOrEqual(b.x + b.w);
    const edge = bubbleBox('ON YOUR MARKS', 315, 4);
    expect(edge.x + edge.w).toBeLessThanOrEqual(318);
    expect(edge.y).toBeGreaterThanOrEqual(2);
  });
});

const win = (ms: number): RaceOutcome => ({ result: 'win', place: 1, ms }) as unknown as RaceOutcome;

describe('Gauntlet run (design 32)', () => {
  it('advances on a win, clears at tier 7 and ends on anything else', () => {
    let run = newGauntletRun('100m');
    for (let tier = 1; tier < 7; tier++) {
      const step = gauntletAfterRace(run, win(10_000 + tier));
      expect(step.kind).toBe('between');
      run = step.run;
    }
    expect(run.tier).toBe(7);
    expect(gauntletStrip(run, 500)).toBe(`7/7  TOTAL 1:00.53`);
    const clear = gauntletAfterRace(run, win(9000));
    expect(clear.kind).toBe('clear');
    expect(clear.run.times).toHaveLength(7);
    const lose = { result: 'lose', place: 2, ms: 9000 } as unknown as RaceOutcome;
    expect(gauntletAfterRace(newGauntletRun('100m'), lose)).toEqual({
      kind: 'over',
      run: newGauntletRun('100m'),
    });
    expect(furthestText(4)).toBe('FURTHEST 4/7');
  });
});

describe('reveal timeline (design 30.2-30.3)', () => {
  const full = revealTimeline('full', 1000);
  const short = revealTimeline('short', 1000);
  it('matches the full timeline', () => {
    expect(full.card?.interruptAt).toBe(4.0);
    expect(full.cutAt).toBe(6.6);
    expect(full.drones.map((d) => [d.lane, d.at])).toEqual([
      [5, 7.6],
      [4, 8.0],
      [3, expect.closeTo(8.4, 5)],
      [2, expect.closeTo(8.8, 5)],
    ]);
    expect(full.zyxAt).toBe(9.2);
    expect(bubbleAt(full, 10)?.text).toBe('CUTE TROPHY.');
    expect(bubbleAt(full, 12)?.text).toBe('NOW RUN WITH US.');
    expect(full.finalAt).toBe(13.0);
    expect(full.skipAfter).toBe(1);
  });
  it('steps the sky 4 times, or once with reduced flashing', () => {
    expect([6.6, 6.9, 7.15, 7.4, 7.6].map((t) => skyStepAt(full, t, false))).toEqual([0, 1, 2, 3, 4]);
    expect([6.6, 7.4, 7.6].map((t) => skyStepAt(full, t, true))).toEqual([0, 0, 4]);
  });
  it('compresses the short version to 6.4 s with one bubble and an instant skip', () => {
    expect(short.card).toBeNull();
    expect(short.finalAt).toBe(6.4);
    expect(short.skySteps * short.skyStep).toBe(0.5);
    expect(short.drones[1]?.at ?? 0).toBeCloseTo((short.drones[0]?.at ?? 0) + 0.3, 5);
    expect(short.bubbles).toEqual([{ text: 'AGAIN?', at: 3.2, dur: 1.4 }]);
    expect(short.skipAfter).toBe(0);
  });
});

describe('records columns (design 29.2)', () => {
  it('never overlaps the widest cells of any event', () => {
    for (const [event, col] of Object.entries(RECORDS_COLUMNS)) {
      const name = event === '400m' ? 'UNIT-7' : 'VALENTINA';
      const time = event === '400m' ? '1:12.00' : '22.00';
      const centred = (x: number, w: number) => [x - w / 2, x + w / 2] as const;
      const spans: (readonly [number, number])[] = [
        [col.name, col.name + miniTextWidth(name)],
        [col.pip, col.place + miniTextWidth('6TH')],
        centred(col.pb, miniTextWidth(time)),
        ...(col.hit !== null ? [centred(col.hit, miniTextWidth('HIT'))] : []),
        centred(col.target, miniTextWidth(time)),
        ...col.last.map((x) => {
          const c = lastCell(time, '6', x);
          return [c.timeX, c.timeX + c.w] as const;
        }),
      ];
      for (let i = 1; i < spans.length; i++) {
        expect(
          (spans[i]?.[0] ?? 0) - (spans[i - 1]?.[1] ?? 0),
          `${event} column ${i}`,
        ).toBeGreaterThanOrEqual(2);
      }
      expect(spans[spans.length - 1]?.[1] ?? 999).toBeLessThanOrEqual(316);
    }
  });
});

describe('speech bubble avoidance (design 6.3, 31.2)', () => {
  it('slides past the countdown digit toward the anchor side', () => {
    const digit = { x: 138, y: 50, w: 44, h: 42 };
    const b = bubbleBox('ON YOUR MARKS', 171, 76, 320, digit);
    expect(b.x).toBeGreaterThanOrEqual(184);
    expect(b.tailX).toBeGreaterThanOrEqual(b.x);
    const left = bubbleBox('SET', 120, 76, 320, digit);
    expect(left.x + left.w).toBeLessThanOrEqual(136);
    expect(bubbleBox('SET', 60, 76, 320, digit).x).toBe(bubbleBox('SET', 60, 76).x);
  });
});
