import { describe, expect, it } from 'vitest';
import type { RaceOutcome, Standing } from '../../core/index.ts';
import { DASH } from '../content/index.ts';
import { resultCard, resultKind } from './result.ts';

const rio: Standing['who'] = { kind: 'player', id: 'rio' };
const pip: Standing['who'] = { kind: 'rival', id: 'pip' };
const field = (name: string): Standing['who'] => ({
  kind: 'field',
  field: { tier: 1, body: 'fKid', variant: 'A', name },
});

function row(
  lane: number,
  who: Standing['who'],
  name: string,
  ms: number | null,
  place: number | null,
): Standing {
  return { lane, who, name, ms, place };
}

/** A 100 m outcome against Pip; `standings` in place order. */
function outcome(over: Partial<RaceOutcome>): RaceOutcome {
  return {
    event: '100m',
    opponent: 'pip',
    result: 'win',
    ms: 15000,
    oppMs: 18000,
    marginMs: -3000,
    photoFinish: false,
    falseStarts: 0,
    seed: 1,
    hit: null,
    splits: [],
    mode: 'l',
    place: 1,
    fieldSize: 6,
    winMs: 15000,
    standings: [
      row(0, rio, 'RIO', 15000, 1),
      row(1, pip, 'PIP', 18000, 2),
      row(2, field('DOT'), 'DOT', 18500, 3),
      row(3, field('MILO'), 'MILO', 18600, 4),
      row(4, field('NOOR'), 'NOOR', 18700, 5),
      row(5, field('BEA'), 'BEA', 18800, 6),
    ],
    steps: 150,
    fumbles: 0,
    fumble2: 0,
    trips: 0,
    input: 'k',
    staminaEmptyM: null,
    ...over,
  };
}

describe('resultCard', () => {
  it('maps a win to the win copy with the times and the standings as columns', () => {
    const c = resultCard(outcome({}), DASH);
    expect(c.kind).toBe('win');
    expect(c.header).toBe(DASH.output.complete);
    expect(c.title).toBe(DASH.win.title);
    expect(c.line).toBe(DASH.win.line('15.00', '18.00'));
    expect(c.cta).toBe(DASH.win.cta);
    expect(c.rows).toHaveLength(6);
    expect(c.rows[0]).toEqual({ place: '1ST', name: 'RIO', time: '15.00', you: true });
    expect(c.rows[1]).toEqual({ place: '2ND', name: 'PIP', time: '18.00', you: false });
  });

  it('maps a win by the photo margin to PHOTO FINISH', () => {
    const c = resultCard(outcome({ photoFinish: true, oppMs: 15030 }), DASH);
    expect(resultKind(outcome({ photoFinish: true }))).toBe('photo');
    expect(c.title).toBe(DASH.photoFinish.title);
    expect(c.cta).toBe(DASH.photoFinish.cta);
  });

  it('names the winner of a loss, Pip or a field runner', () => {
    const pipWins = outcome({
      result: 'lose',
      ms: 19000,
      place: 2,
      standings: [row(1, pip, 'PIP', 18000, 1), row(0, rio, 'RIO', 19000, 2)],
    });
    expect(resultCard(pipWins, DASH).title).toBe(DASH.lose.title('PIP'));
    expect(resultCard(pipWins, DASH).line).toBe(DASH.lose.line('19.00', '18.00'));
    const dotWins = outcome({
      result: 'lose',
      ms: 17900,
      place: 2,
      standings: [
        row(2, field('DOT'), 'DOT', 17800, 1),
        row(0, rio, 'RIO', 17900, 2),
        row(1, pip, 'PIP', 18000, 3),
      ],
    });
    const c = resultCard(dotWins, DASH);
    expect(c.kind).toBe('lose');
    expect(c.title).toBe('DOT WINS!');
  });

  it('shows a DNF without a time or place', () => {
    const c = resultCard(
      outcome({
        result: 'dnf',
        ms: null,
        place: null,
        standings: [row(1, pip, 'PIP', 18000, 1), row(0, rio, 'RIO', null, null)],
      }),
      DASH,
    );
    expect(c.kind).toBe('lose');
    expect(c.rows[1]).toEqual({ place: '-', name: 'RIO', time: DASH.noTime, you: true });
    expect(c.line).toBe(DASH.lose.line(DASH.noTime, '18.00'));
  });

  it('maps a DQ to the disqualified copy with no standings', () => {
    const c = resultCard(outcome({ result: 'dq', ms: null, oppMs: null, place: null, falseStarts: 2 }), DASH);
    expect(c).toEqual({
      kind: 'dq',
      header: DASH.output.halted,
      title: DASH.disqualified.title,
      line: DASH.disqualified.line,
      cta: DASH.disqualified.cta,
      rows: [],
    });
  });
});
