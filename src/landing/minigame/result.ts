/**
 * The dash's result card from a race outcome: which DASH copy applies, the times, and the
 * standings as program output columns. Pure.
 */
import { formatTime, TUNING, type RaceOutcome } from '../../core/index.ts';
import type { DashCopy } from '../content/index.ts';
import { ordinal } from './hud.ts';

export type ResultKind = 'win' | 'photo' | 'lose' | 'dq';

export interface StandingRow {
  /** '1ST', or '-' for a player without a place (DNF). */
  readonly place: string;
  readonly name: string;
  /** '17.92', or DASH.noTime. */
  readonly time: string;
  readonly you: boolean;
}

export interface ResultCard {
  readonly kind: ResultKind;
  /** RACE.EXE COMPLETE or RACE.EXE HALTED. */
  readonly header: string;
  readonly title: string;
  /** The YOU / PIP line: the aria-live announcement and the card's summary. */
  readonly line: string;
  readonly cta: string;
  /** All six runners in place order; empty for a DQ (nobody's time counts). */
  readonly rows: readonly StandingRow[];
}

export function resultKind(o: RaceOutcome): ResultKind {
  if (o.result === 'dq') return 'dq';
  if (o.result === 'win') return o.photoFinish ? 'photo' : 'win';
  return 'lose';
}

export function resultCard(o: RaceOutcome, copy: DashCopy): ResultCard {
  const kind = resultKind(o);
  if (kind === 'dq') {
    const d = copy.disqualified;
    return { kind, header: copy.output.halted, title: d.title, line: d.line, cta: d.cta, rows: [] };
  }
  const time = (ms: number | null): string => (ms === null ? copy.noTime : formatTime(ms));
  const you = time(o.ms);
  const pip = time(o.oppMs);
  const rows = o.standings.map((s): StandingRow => ({
    place: s.place === null ? '-' : ordinal(s.place),
    name: s.name,
    time: time(s.ms),
    you: s.lane === TUNING.PLAYER_LANE,
  }));
  const base = { kind, header: copy.output.complete, rows };
  if (kind === 'lose') {
    const winner = o.standings.find((s) => s.lane !== TUNING.PLAYER_LANE && s.place === 1);
    const l = copy.lose;
    return { ...base, title: l.title(winner?.name ?? ''), line: l.line(you, pip), cta: l.cta };
  }
  const w = kind === 'photo' ? copy.photoFinish : copy.win;
  return { ...base, title: w.title, line: w.line(you, pip), cta: w.cta };
}
