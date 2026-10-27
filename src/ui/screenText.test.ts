import { describe, expect, it } from 'vitest';
import type { RaceOutcome, Settings } from '../core/index.ts';
import { PAL } from './hudMath.ts';
import { historyCell, isToggle, optionValue, resultTimeText, resultTitle } from './screenText.ts';

const base: RaceOutcome = {
  opponent: 'pip',
  result: 'win',
  ms: 11841,
  oppMs: 18000,
  marginMs: -6159,
  photoFinish: false,
  falseStarts: 0,
  seed: 1,
};

describe('results card text (design 6.6)', () => {
  it('titles every outcome with the design colours', () => {
    expect(resultTitle(base)).toEqual({ text: 'YOU WIN!', color: PAL.gold });
    expect(resultTitle({ ...base, photoFinish: true, marginMs: 0 })).toEqual({
      text: 'PHOTO FINISH',
      color: PAL.gold,
    });
    expect(resultTitle({ ...base, result: 'lose' })).toEqual({ text: 'YOU LOSE', color: 17 });
    expect(resultTitle({ ...base, result: 'dq' }).text).toBe('DISQUALIFIED');
    expect(resultTitle({ ...base, result: 'dnf' }).text).toBe('DID NOT FINISH');
  });

  it('shows DQ / DNF instead of a time', () => {
    expect(resultTimeText({ ...base, result: 'dq', ms: null })).toBe('DQ');
    expect(resultTimeText({ ...base, result: 'dnf', ms: null })).toBe('DNF');
    expect(resultTimeText(base)).toBe('11.85');
  });
});

describe('records history cells (design 4.5)', () => {
  it('renders DQ, DNF and times', () => {
    const e = { opp: 'pip', ms: 12840, oppMs: 18000, falseStarts: 0, seed: 1, at: '' } as const;
    expect(historyCell({ ...e, result: 'win' })).toBe('12.84');
    expect(historyCell({ ...e, result: 'dq', ms: null })).toBe('DQ');
    expect(historyCell({ ...e, result: 'dnf', ms: null })).toBe('DNF');
  });
});

describe('options rows', () => {
  const s: Settings = { volume: 8, muted: true, reducedFlashing: false, screenShake: true, crt: false };
  it('renders values and classifies toggles', () => {
    expect(optionValue('volume', s)).toBe('< 8 >');
    expect(optionValue('muted', s)).toBe('ON');
    expect(optionValue('reducedFlashing', s)).toBe('OFF');
    expect(optionValue('reset', s)).toBeNull();
    expect(isToggle('crt')).toBe(true);
    expect(isToggle('volume')).toBe(false);
  });
});
