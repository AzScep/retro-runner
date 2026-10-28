import { describe, expect, it } from 'vitest';
import { EVENT_COURSE, EVENT_IDS, EVENT_LOCK_TEXT, LADDERS, meet, OPPONENTS } from '../core/index.ts';
import {
  EVENTS_HELP,
  gauntletIsNew,
  hapticsAvailable,
  LADDER_GOAL,
  LADDER_HELP,
  ladderLockLines,
  ladderTotalProgress,
  ladderTotalProgressShort,
} from './menuText.ts';
import { miniTextWidth, wrapMini } from './miniFont.ts';

/** Ladder rival card flavour area: card width 192 minus 8 px padding each side, 2 lines. */
const CARD_TEXT_W = 176;
/** Event Select card: 96 px wide, 6 px padding each side (EventSelectScene). */
const EVENT_CARD_TEXT_W = 84;
const PS_GLYPH = 8;

describe('ladder card copy (design 1.3, 24.1)', () => {
  it('says 1st place unlocks and fits the card for every rival of every event', () => {
    for (const event of EVENT_IDS) {
      LADDERS[event].forEach((entry, i) => {
        const prevEntry = LADDERS[event][i - 1];
        const prev = prevEntry
          ? { name: OPPONENTS[prevEntry.id].name, unlocked: true, meet: meet(prevEntry.tier).name }
          : null;
        for (const p of prev ? [prev, { ...prev, unlocked: false }] : [null]) {
          const lines = ladderLockLines(p);
          expect(lines.length, `${event} ${entry.id}`).toBe(p === null ? 0 : 2);
          for (const l of lines) {
            expect(miniTextWidth(l), l).toBeLessThanOrEqual(CARD_TEXT_W);
            expect(l).not.toMatch(/BEAT/);
          }
        }
      });
    }
  });

  it('names the previous rival once unlocked, else only its meet', () => {
    expect(ladderLockLines({ name: 'PIP', unlocked: true, meet: 'SPORTS DAY' })).toEqual([
      'FINISH 1ST VS PIP',
      'TO UNLOCK',
    ]);
    expect(ladderLockLines({ name: 'MARCO', unlocked: false, meet: 'CAMPUS GAMES' })).toEqual([
      'FINISH 1ST AT CAMPUS GAMES',
      'TO UNLOCK',
    ]);
  });

  it('states the goal of a fresh event in two lines that fit', () => {
    expect(LADDER_GOAL).toHaveLength(2);
    for (const l of LADDER_GOAL) expect(miniTextWidth(l)).toBeLessThanOrEqual(CARD_TEXT_W);
    expect(LADDER_GOAL.join(' ')).toContain('FINISH 1ST');
  });
});

describe('key hints (M2)', () => {
  it('fit the 320 px canvas with an 8 px margin', () => {
    for (const h of [EVENTS_HELP, LADDER_HELP]) expect(miniTextWidth(h)).toBeLessThanOrEqual(304);
    expect(LADDER_HELP).toContain('ESC: BACK');
    expect(EVENTS_HELP).toContain('ESC: BACK');
  });
});

describe('event lock text (design 12.2)', () => {
  it('asks for a win by tier, never "beat" or a rival name the player may not have seen', () => {
    expect(EVENT_LOCK_TEXT['110mh']).toEqual(['WIN TIER 3 IN 100M']);
    expect(EVENT_LOCK_TEXT['400m']).toEqual(['WIN TIER 4 IN 100M', 'OR TIER 3 IN HURDLES']);
    const names = Object.values(OPPONENTS).map((o) => o.name);
    for (const lines of Object.values(EVENT_LOCK_TEXT)) {
      for (const l of lines) {
        expect(l).not.toMatch(/BEAT/);
        for (const n of names) expect(l.split(' ')).not.toContain(n);
      }
    }
  });

  it('wraps to at most 4 lines on an event card and fits the 8 px records page', () => {
    for (const lines of Object.values(EVENT_LOCK_TEXT)) {
      expect(lines.flatMap((l) => wrapMini(l, EVENT_CARD_TEXT_W)).length).toBeLessThanOrEqual(4);
      for (const l of lines) expect(l.length * PS_GLYPH).toBeLessThanOrEqual(304);
    }
  });
});

describe('first race tips (13.4.4, 14.3.9, R1)', () => {
  it('teaches alternation in the 100 m, and every tip fits its 8 px panel', () => {
    const tip = EVENT_COURSE['100m'].firstRaceTip;
    expect(tip?.keyboard).toBe('ALTERNATE LEFT + RIGHT');
    expect(tip?.touch).toBe('TAP LEFT, RIGHT, LEFT...');
    for (const e of EVENT_IDS) {
      const t = EVENT_COURSE[e].firstRaceTip;
      // HudScene draws the tip at 8 px per glyph on a panel 16 px wider, centred on 320.
      for (const s of t ? [t.keyboard, t.touch] : [])
        expect(s.length * PS_GLYPH + 16).toBeLessThanOrEqual(304);
    }
  });
});

describe('ladder total progress (16.5, 29.1.3)', () => {
  it('counts the 6 visible rivals before the reveal and all 7 after', () => {
    expect(ladderTotalProgress(4, false)).toBe('PBS SET 4/6');
    expect(ladderTotalProgress(5, true)).toBe('SET A PB VS ALL 7: 5/7');
    expect(ladderTotalProgressShort(4, false)).toBe('PBS 4/6');
    expect(ladderTotalProgressShort(6, true)).toBe('PBS 6/7');
    // The 8 px records footer and the event card's mini line.
    expect(ladderTotalProgress(7, true).length * PS_GLYPH).toBeLessThanOrEqual(304);
    expect(miniTextWidth(ladderTotalProgressShort(7, true))).toBeLessThanOrEqual(EVENT_CARD_TEXT_W);
  });
});

describe('menu rules', () => {
  it('badges GAUNTLET as new from the reveal until the first run is recorded', () => {
    expect(gauntletIsNew(false, 0)).toBe(false);
    expect(gauntletIsNew(true, 0)).toBe(true);
    expect(gauntletIsNew(true, 1)).toBe(false);
  });

  it('lists HAPTICS only with the Vibration API and a coarse pointer (design 17.7)', () => {
    expect(hapticsAvailable({ vibrate: true, coarsePointer: true })).toBe(true);
    // Desktop Chromium: navigator.vibrate exists, the pointer is a mouse.
    expect(hapticsAvailable({ vibrate: true, coarsePointer: false })).toBe(false);
    // iOS Safari: coarse pointer, no Vibration API.
    expect(hapticsAvailable({ vibrate: false, coarsePointer: true })).toBe(false);
  });
});
