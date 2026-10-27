import { describe, expect, it } from 'vitest';
import type { RaceOutcome, Settings } from '../core/index.ts';
import { PAL } from './hudMath.ts';
import {
  championTitle,
  firstRaceTip,
  historyCell,
  hitCell,
  hurdlesRow,
  isToggle,
  optionValue,
  resultTimeText,
  resultTitle,
  splitPopup,
  splitsRow,
  titlePrompt,
} from './screenText.ts';

const base: RaceOutcome = {
  event: '100m',
  hit: null,
  splits: [],
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
  const s: Settings = {
    volume: 8,
    muted: true,
    reducedFlashing: false,
    screenShake: true,
    crt: false,
    haptics: true,
  };
  it('renders values and classifies toggles', () => {
    expect(optionValue('volume', s)).toBe('< 8 >');
    expect(optionValue('muted', s)).toBe('ON');
    expect(optionValue('reducedFlashing', s)).toBe('OFF');
    expect(optionValue('reset', s)).toBeNull();
    expect(isToggle('crt')).toBe(true);
    expect(isToggle('haptics')).toBe(true);
    expect(optionValue('haptics', s)).toBe('ON');
    expect(isToggle('volume')).toBe(false);
  });
});

describe('v2 copy (design 12-18)', () => {
  it('formats 400 m times as M:SS.hh in results and records', () => {
    expect(resultTimeText({ ...base, event: '400m', ms: 64361 })).toBe('1:04.37');
  });

  it('follows the input modality', () => {
    expect(titlePrompt('keyboard')).toBe('PRESS ENTER');
    expect(titlePrompt('touch')).toBe('TAP TO START');
    expect(firstRaceTip('110mh', 'keyboard')).toBe('UP TO JUMP');
    expect(firstRaceTip('110mh', 'touch')).toBe('TAP JUMP');
    expect(firstRaceTip('400m', 'touch')).toBe('WATCH STAMINA. STEADY BEATS FAST.');
    expect(firstRaceTip('100m', 'keyboard')).toBeNull();
  });

  it('builds the results event rows and HUD split popups', () => {
    expect(hurdlesRow(0)).toEqual({ text: 'CLEAN RACE!', color: PAL.gold });
    expect(hurdlesRow(2)).toEqual({ text: 'HURDLES HIT 2/10', color: PAL.white });
    expect(splitsRow([13920, 26100, 38250])).toBe('100 13.92  200 26.10  300 38.25');
    expect(splitsRow([13920])).toBe('100 13.92  200 --  300 --');
    expect(splitPopup(1, 26100)).toBe('200M 26.10');
    expect(hitCell(undefined)).toBe('-');
    expect(hitCell(0)).toBe('0');
  });

  it('titles each champion screen', () => {
    expect(championTitle('100m')).toBe('100M CHAMPION');
    expect(championTitle('110mh')).toBe('HURDLES CHAMPION');
    expect(championTitle('400m')).toBe('400M CHAMPION');
  });
});
