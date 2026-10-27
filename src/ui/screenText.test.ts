import { describe, expect, it } from 'vitest';
import type { HistoryEntry, RaceOutcome, Settings, Standing } from '../core/index.ts';
import { PAL } from './hudMath.ts';
import {
  championTitle,
  firstRaceTip,
  gauntletOutLine,
  historyCell,
  historyPlace,
  livePlaceColor,
  marginText,
  medalRow,
  meetSubtitle,
  ordinal,
  starterBubble,
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
  mode: 'l',
  place: 1,
  fieldSize: 6,
  winMs: 11841,
  standings: [],
  steps: 100,
  fumbles: 0,
  fumble2: 0,
  trips: 0,
  input: 'k',
};

function standing(lane: number, ms: number | null, place: number | null): Standing {
  const who =
    lane === 0
      ? ({ kind: 'player', id: 'rio' } as const)
      : lane === 1
        ? ({ kind: 'rival', id: 'pip' } as const)
        : ({ kind: 'field', field: { tier: 1, body: 'fKid', variant: 'A', name: 'DOT' } } as const);
  return { lane, who, name: `L${lane}`, ms, place };
}

describe('results card text (design 6.6)', () => {
  it('titles every outcome with the design colours', () => {
    expect(resultTitle(base)).toEqual({ text: 'YOU WIN!', color: PAL.gold });
    expect(resultTitle({ ...base, photoFinish: true, marginMs: 0 })).toEqual({
      text: 'PHOTO FINISH',
      color: PAL.gold,
    });
    expect(resultTitle({ ...base, result: 'lose', place: 2 })).toEqual({
      text: '2ND PLACE',
      color: PAL.white,
    });
    expect(resultTitle({ ...base, result: 'lose', place: 3 })).toEqual({
      text: '3RD PLACE',
      color: PAL.white,
    });
    expect(resultTitle({ ...base, result: 'lose', place: 5 })).toEqual({ text: '5TH PLACE', color: PAL.red });
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
    const e = {
      opp: 'pip',
      ms: 12840,
      oppMs: 18000,
      falseStarts: 0,
      seed: 1,
      at: '',
      place: 1,
      fieldSize: 6,
      winMs: 12840,
      mode: 'l',
    } as const;
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
    expect(hurdlesRow(2)).toEqual({ text: 'HIT 2/10', color: PAL.white });
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

describe('v3 results, HUD and card text (design 27-32)', () => {
  it('labels places and colours the live position', () => {
    expect([1, 2, 3, 4, 5, 6].map(ordinal)).toEqual(['1ST', '2ND', '3RD', '4TH', '5TH', '6TH']);
    expect([1, 2, 3, 4, 6].map(livePlaceColor)).toEqual([22, 7, 21, 8, 8]);
  });

  it('shows the lead to 2nd after a win and the gap to the winner otherwise', () => {
    const win: RaceOutcome = {
      ...base,
      ms: 11000,
      standings: [standing(0, 11000, 1), standing(3, 11120, 2), standing(1, 11300, 3)],
    };
    expect(marginText(win)).toBe('AHEAD -0.12');
    const lose: RaceOutcome = {
      ...base,
      result: 'lose',
      ms: 11310,
      place: 3,
      winMs: 11000,
      standings: [standing(1, 11000, 1), standing(2, 11200, 2), standing(0, 11310, 3)],
    };
    expect(marginText(lose)).toBe('TO 1ST +0.31');
    const heat: RaceOutcome = { ...win, standings: [standing(0, 11000, 1), standing(1, 11000, 1)] };
    expect(marginText(heat)).toBe('DEAD HEAT');
    expect(marginText({ ...base, result: 'dq', ms: null, place: null })).toBeNull();
  });

  it('picks the medal row by priority', () => {
    const lose: RaceOutcome = {
      ...base,
      result: 'lose',
      place: 2,
      standings: [standing(2, 11000, 1), standing(0, 11100, 2), standing(1, 11200, 3)],
    };
    const facts = {
      outcome: lose,
      unlockedName: null,
      becameChampion: false,
      revealPending: false,
      newBestPlace: null,
      rivalName: 'PIP',
      bestPlace: 2,
    };
    expect(medalRow({ ...facts, revealPending: true }).text).toBe('CHAMPIONSHIP WON!');
    expect(medalRow({ ...facts, unlockedName: 'JESS' }).text).toBe('JESS UNLOCKED!');
    expect(medalRow({ ...facts, newBestPlace: 2 })).toMatchObject({ text: 'SILVER!', medal: 2 });
    expect(medalRow({ ...facts, newBestPlace: 3 })).toMatchObject({ text: 'BRONZE!', medal: 3 });
    expect(medalRow(facts)).toMatchObject({ text: 'BEAT PIP!', color: PAL.white });
    const behind = { ...lose, place: 4, standings: [standing(1, 11000, 1), standing(0, 11500, 4)] };
    expect(medalRow({ ...facts, outcome: behind, bestPlace: null })).toMatchObject({
      text: 'BEST --',
      color: PAL.midGrey,
    });
    expect(medalRow({ ...facts, outcome: behind, bestPlace: 2 }).text).toBe('BEST 2ND');
  });

  it('adds the place digit only for 6-runner history entries', () => {
    const e: HistoryEntry = {
      opp: 'pip',
      result: 'lose',
      ms: 12410,
      oppMs: 12000,
      falseStarts: 0,
      seed: 1,
      at: '',
      place: 2,
      fieldSize: 6,
      winMs: 12000,
      mode: 'l',
    };
    expect(historyPlace(e)).toBe('2');
    expect(historyPlace({ ...e, fieldSize: 2 })).toBe('');
    expect(historyPlace({ ...e, result: 'dq', place: null, ms: null })).toBe('');
  });

  it('writes the meet card line, starter bubbles and the Gauntlet over line', () => {
    expect(meetSubtitle('100m', 'PIP', null)).toBe('100M FINAL - VS PIP');
    expect(meetSubtitle('110mh', 'JESS', null)).toBe('110M HURDLES FINAL - VS JESS');
    expect(meetSubtitle('400m', 'SOL', 3)).toBe('MEET 3 OF 7 - VS SOL');
    const f = { phase: 'countdown', countdown: 3, falseStarts: 0, disqualified: false } as const;
    expect(starterBubble(f)).toBe('ON YOUR MARKS');
    expect(starterBubble({ ...f, countdown: 2 })).toBe('ON YOUR MARKS');
    expect(starterBubble({ ...f, countdown: 1 })).toBe('SET');
    expect(starterBubble({ ...f, phase: 'running', countdown: 'go' })).toBeNull();
    expect(starterBubble({ ...f, phase: 'falseStart', countdown: null })).toBe('FALSE START!');
    expect(starterBubble({ ...f, phase: 'finished', disqualified: true })).toBe('DISQUALIFIED');
    expect(starterBubble({ ...f, phase: 'intro', countdown: null })).toBeNull();
    expect(gauntletOutLine('CITY OPEN', { ...base, result: 'lose', place: 3 })).toBe(
      'OUT AT CITY OPEN - 3RD',
    );
    expect(gauntletOutLine('CITY OPEN', { ...base, result: 'dq', place: null })).toBe(
      'OUT AT CITY OPEN - DQ',
    );
    expect(gauntletOutLine('NEON CUP', null)).toBe('ABANDONED AT NEON CUP');
  });
});
