import { describe, expect, it } from 'vitest';
import type { RaceOutcome, Standing } from '../core/index.ts';
import { RIVAL_KIT as CORE_KIT } from '../core/index.ts';
import {
  finishCall,
  hurdlePopup,
  keyPrompt,
  PAL,
  RIVAL_KIT,
  speedSegmentColor,
  splitPopupText,
  sustainDividerOffset,
  sustainSegments,
  type KeyPromptInput,
} from './hudMath.ts';

const running: KeyPromptInput = {
  running: true,
  idleMs: 0,
  fumblesSinceStep: 0,
  stepsSinceGuide: 0,
  expectedSide: 'R',
  reducedFlashing: false,
};

describe('key prompt (6.4, R1)', () => {
  it('before GO both keys are dim and nothing is said', () => {
    expect(keyPrompt({ ...running, running: false })).toEqual({ text: null, L: 'dim', R: 'dim' });
  });

  it('lights only the expected key while alternating', () => {
    expect(keyPrompt(running)).toEqual({ text: null, L: 'dim', R: 'bright' });
    expect(keyPrompt({ ...running, expectedSide: null })).toEqual({ text: null, L: 'bright', R: 'bright' });
  });

  it('a one-key masher gets ALTERNATE! with the next key steady, never the MASH! pulse', () => {
    for (const idleMs of [0, 600, 1100, 5000]) {
      expect(keyPrompt({ ...running, idleMs, fumblesSinceStep: 2 })).toEqual({
        text: 'ALTERNATE!',
        L: 'wrong',
        R: 'bright',
      });
    }
    // One stray fumble is not a pattern yet.
    expect(keyPrompt({ ...running, fumblesSinceStep: 1 }).text).toBeNull();
  });

  it('MASH! pulses at 2 Hz (1 Hz reduced) only for a player pressing nothing', () => {
    expect(keyPrompt({ ...running, idleMs: 499 }).text).toBeNull();
    expect(keyPrompt({ ...running, idleMs: 500 })).toEqual({ text: 'MASH!', L: 'bright', R: 'bright' });
    expect(keyPrompt({ ...running, idleMs: 800 })).toEqual({ text: null, L: 'dim', R: 'dim' });
    expect(keyPrompt({ ...running, idleMs: 800, reducedFlashing: true }).text).toBe('MASH!');
  });

  it('reduced flashing guides with the expected key for the first steps and after a fumble', () => {
    const rf = { ...running, reducedFlashing: true };
    expect(keyPrompt({ ...rf, stepsSinceGuide: 3 })).toEqual({ text: null, L: 'dim', R: 'bright' });
    expect(keyPrompt({ ...rf, stepsSinceGuide: 4 })).toEqual({ text: null, L: 'bright', R: 'bright' });
  });
});

describe('hurdle popups (R4)', () => {
  it('says which way to correct', () => {
    expect(hurdlePopup('clip', 'early').text).toBe('EARLY');
    expect(hurdlePopup('clip', 'late').text).toBe('LATE');
    expect(hurdlePopup('hit', 'early').text).toBe('TOO EARLY');
    expect(hurdlePopup('hit', undefined).text).toBe('JUMP!');
    expect(hurdlePopup('clear', undefined)).toEqual({ text: 'CLEAN', color: PAL.green });
  });
});

describe('400 m pacing cues (R5)', () => {
  it('the sustain divider sits in the gap after the 6 sustain segments', () => {
    expect(sustainSegments()).toBe(6);
    expect(sustainDividerOffset()).toBe(35);
  });

  it('over pace is red only while draining in the 400 m', () => {
    expect(speedSegmentColor(6, '400m', true)).toBe(PAL.green);
    expect(speedSegmentColor(7, '400m', true)).toBe(PAL.redLight);
    expect(speedSegmentColor(10, '400m', false)).toBe(PAL.gold);
    expect(speedSegmentColor(10, '100m', false)).toBe(PAL.redLight);
  });

  it('split popups add the last 100 m segment', () => {
    expect(splitPopupText(0, [10360])).toBe('100M 10.36');
    expect(splitPopupText(1, [10360, 25410])).toBe('200M 25.41 (+15.05)');
    expect(splitPopupText(2, [10360, 25410, 42460])).toBe('300M 42.46 (+17.05)');
  });
});

const row = (lane: number, ms: number | null, place: number | null): Standing => ({
  lane,
  who: lane === 0 ? { kind: 'player', id: 'rio' } : { kind: 'rival', id: 'pip' },
  name: String(lane),
  ms,
  place,
});

function outcome(ms: number | null, place: number | null, standings: Standing[]): RaceOutcome {
  return { ms, place, standings } as unknown as RaceOutcome;
}

describe('finish callout (R7)', () => {
  it('shows the place, coloured like the results title', () => {
    expect(finishCall(outcome(12000, 1, [row(0, 12000, 1), row(1, 12500, 2)]))).toEqual({
      text: '1ST!',
      color: PAL.gold,
      photo: false,
    });
    expect(finishCall(outcome(13000, 5, [row(1, 12000, 1), row(0, 13000, 5)]))?.color).toBe(PAL.redLight);
  });

  it('PHOTO! when within 50 ms of the runner just ahead or behind', () => {
    expect(finishCall(outcome(12040, 2, [row(1, 12000, 1), row(0, 12040, 2), row(2, 13000, 3)]))?.photo).toBe(
      true,
    );
    expect(finishCall(outcome(12000, 1, [row(0, 12000, 1), row(1, 12050, 2)]))?.photo).toBe(true);
    expect(finishCall(outcome(12000, 1, [row(0, 12000, 1), row(1, 12051, 2)]))?.photo).toBe(false);
  });

  it('nothing for DQ or DNF', () => {
    expect(finishCall(outcome(null, null, [row(1, 12000, 1), row(0, null, null)]))).toBeNull();
  });
});

describe('rival kit', () => {
  it('the HUD and the world chevron share the core table', () => {
    expect(RIVAL_KIT).toBe(CORE_KIT);
  });
});
