/** Pure text rules for screens (results card, records table, options rows). No Phaser. */
import {
  EVENT_COURSE,
  EVENTS,
  formatMargin,
  formatTime,
  type EventId,
  type HistoryEntry,
  type Modality,
  type RaceOutcome,
  type Settings,
} from '../core/index.ts';
import { PAL } from './hudMath.ts';

/** Width of the results card's right column (design 28.1: panel x 184-300). */
export const RESULT_FACTS_W = 116;

/** Ordinal place label (design 27.1, 28.1): 1 -> `1ST`, 2 -> `2ND`, 3 -> `3RD`, 4-6 -> `4TH`..`6TH`. */
export function ordinal(place: number): string {
  const suffix = place === 1 ? 'ST' : place === 2 ? 'ND' : place === 3 ? 'RD' : 'TH';
  return `${place}${suffix}`;
}

/** Live position colour (design 27.1): 1ST index 22, 2ND index 7, 3RD index 21, 4TH-6TH index 8. */
export function livePlaceColor(place: number): number {
  if (place === 1) return PAL.gold;
  if (place === 2) return PAL.lightGrey;
  if (place === 3) return PAL.orange;
  return PAL.white;
}

/** Title text and colour for an outcome (design 28.1). */
export function resultTitle(outcome: RaceOutcome): { text: string; color: number } {
  switch (outcome.result) {
    case 'win':
      return outcome.photoFinish
        ? { text: 'PHOTO FINISH', color: PAL.gold }
        : { text: 'YOU WIN!', color: PAL.gold };
    case 'lose': {
      const place = outcome.place ?? outcome.fieldSize;
      return { text: `${ordinal(place)} PLACE`, color: place <= 3 ? PAL.white : PAL.red };
    }
    case 'dq':
      return { text: 'DISQUALIFIED', color: PAL.red };
    case 'dnf':
      return { text: 'DID NOT FINISH', color: PAL.red };
  }
}

/** Player time on the results card: DQ and DNF have no time. */
export function resultTimeText(o: RaceOutcome): string {
  if (o.result === 'dq') return 'DQ';
  if (o.result === 'dnf') return 'DNF';
  return formatTime(o.ms);
}

/**
 * Results margin (design 28.1): the winner's lead over 2nd as `AHEAD -0.12`, otherwise the gap to
 * the winner as `TO 1ST +0.31`; a dead heat for 1st reads `DEAD HEAT`. Null for DQ / DNF.
 */
export function marginText(outcome: RaceOutcome): string | null {
  const ms = outcome.ms;
  if (ms === null || outcome.place === null) return null;
  if (outcome.place === 1) {
    const second = outcome.standings.find((s) => s.lane !== 0 && s.ms !== null);
    if (!second || second.ms === null) return null;
    const lead = ms - second.ms;
    return lead === 0 ? 'DEAD HEAT' : `AHEAD ${formatMargin(lead)}`;
  }
  if (outcome.winMs === null) return null;
  return `TO 1ST ${formatMargin(ms - outcome.winMs)}`;
}

/** What the medal / unlock row of the results card shows (design 28.1, 30.1.2). */
export interface MedalRow {
  readonly text: string;
  readonly color: number;
  /** Draw the 8x8 medal of this place before the text. */
  readonly medal: 2 | 3 | null;
}

export interface MedalRowFacts {
  readonly outcome: RaceOutcome;
  /** Name of the rival this race unlocked (first 1st place), else null. */
  readonly unlockedName: string | null;
  readonly becameChampion: boolean;
  readonly revealPending: boolean;
  /** 2 or 3 when this race set a new best placing against the rival, else null. */
  readonly newBestPlace: number | null;
  readonly rivalName: string;
}

/**
 * Priority: championship (reveal), unlock, champion, new medal, ahead of the rival; else nothing.
 * Finishing ahead of the rival without winning is praise only: just 1st place unlocks (M1). There is
 * no `BEST <place>` filler, which read like a claim about this race (R3).
 */
export function medalRow(f: MedalRowFacts): MedalRow | null {
  if (f.revealPending) return { text: 'CHAMPIONSHIP WON!', color: PAL.gold, medal: null };
  if (f.unlockedName !== null) return { text: `${f.unlockedName} UNLOCKED!`, color: PAL.gold, medal: null };
  if (f.becameChampion) return { text: 'LADDER CHAMPION!', color: PAL.gold, medal: null };
  if (f.newBestPlace === 2) return { text: 'SILVER!', color: PAL.lightGrey, medal: 2 };
  if (f.newBestPlace === 3) return { text: 'BRONZE!', color: PAL.orange, medal: 3 };
  const o = f.outcome;
  const rival = o.standings.find((s) => s.lane === 1);
  const aheadOfRival =
    o.result === 'lose' &&
    o.place !== null &&
    rival !== undefined &&
    (rival.place === null || o.place < rival.place);
  if (aheadOfRival) return { text: `AHEAD OF ${f.rivalName}`, color: PAL.white, medal: null };
  return null;
}

/** The ladder tier after the raced one; `hidden` while it is the unrevealed tier 7. */
export interface NextTier {
  readonly name: string;
  readonly hidden: boolean;
}

/**
 * Two mini lines under the medal row when a non-1st finish leaves the next tier locked (M1), or null.
 * The hidden tier 7 is never named.
 */
export function unlockHint(o: RaceOutcome, next: NextTier | null): readonly [string, string] | null {
  if (next === null || o.result === 'win') return null;
  return next.hidden ? ['WIN 1ST FOR THE', 'CHAMPIONSHIP'] : ['WIN 1ST TO UNLOCK', next.name];
}

/** `+0.12 OFF PB` (or `EQUALS PB`) under a PB line that this race did not beat; null otherwise. */
export function pbGapText(ms: number | null, bestMs: number | null): string | null {
  if (ms === null || bestMs === null || ms < bestMs) return null;
  return ms === bestMs ? 'EQUALS PB' : `${formatMargin(ms - bestMs)} OFF PB`;
}

/** One line of the results facts block: `big` is the 8 px font, else the mini font. */
export interface FactLine {
  readonly text: string;
  readonly color: number;
  readonly big: boolean;
}

/** Fumbles of at least this share of valid steps are what cost the race. */
const FUMBLE_COST_SHARE = 0.1;
/** Start-up time in the 100 m finish model `T = 100 / r + 2` (design 2.4). */
const START_UP_S = 2;

const fact = (text: string, color: number, big = false): FactLine => ({ text, color, big });

function fumbleLine(o: RaceOutcome): FactLine {
  return fact(`FUMBLES ${o.fumbles}`, o.fumbles > 0 ? PAL.red : PAL.lightGrey);
}

function emptyLine(m: number): FactLine {
  return fact(`EMPTY AT ${m}M`, PAL.red);
}

function fumblesCost(o: RaceOutcome): boolean {
  return o.fumbles > 0 && o.fumbles >= o.steps * FUMBLE_COST_SHARE;
}

/** Valid alternations per second (design 2.3: speed in m/s equals this rate). */
function paceText(o: RaceOutcome, ms: number): string {
  return `PACE ${(o.steps / (ms / 1000)).toFixed(1)}/S`;
}

/**
 * Extra alternations per second that would have matched the winner, from `T = 100 / r + 2`
 * (design 2.4), rounded up to 0.1; null when the model does not apply.
 */
function rateToWin(ms: number, winMs: number): number | null {
  const t = ms / 1000 - START_UP_S;
  const tWin = winMs / 1000 - START_UP_S;
  if (tWin <= 0 || t <= tWin) return null;
  const delta = 100 / tWin - 100 / t;
  return Math.max(1, Math.ceil(delta * 10 - 1e-9)) / 10;
}

/** Time of each 100 m of a finished 400 m (the last ends at the finish). */
function segmentLine(o: RaceOutcome): string {
  const marks = [0, ...o.splits, ...(o.ms === null ? [] : [o.ms])];
  return [0, 1, 2, 3]
    .map((i) => {
      const a = marks[i];
      const b = marks[i + 1];
      return a === undefined || b === undefined ? '--' : formatTime(b - a);
    })
    .join(' ');
}

/**
 * Results facts block (rows 40-62 of the right column, at most 3 lines that fit RESULT_FACTS_W):
 * why a DQ / DNF happened, the 100 m pace and fumbles, the hurdles knocked, the 400 m time of each
 * 100 m and where stamina ran out, plus one actionable line on a loss (R3, R4, R5, R8).
 */
export function resultFacts(o: RaceOutcome): FactLine[] {
  if (o.result === 'dq') {
    return [fact(`${o.falseStarts} FALSE STARTS`, PAL.red, true), fact('WAIT FOR GO!', PAL.lightGrey)];
  }
  const lines: FactLine[] = [];
  if (o.result === 'dnf' || o.ms === null) {
    if (o.fumbles >= o.steps) {
      lines.push(
        fact('NO SPEED', PAL.red, true),
        fact(o.input === 't' ? 'TAP LEFT, RIGHT, LEFT' : 'ALTERNATE KEYS', PAL.white),
      );
    } else {
      lines.push(
        fact('TOO SLOW', PAL.red, true),
        fact(`LIMIT ${formatTime(EVENTS[o.event].dnfMs)}`, PAL.white),
      );
    }
    if (o.staminaEmptyM != null) lines.push(emptyLine(o.staminaEmptyM));
    else if (o.fumbles > 0) lines.push(fumbleLine(o));
    return lines;
  }
  if (o.event === '400m') {
    lines.push(fact('EACH 100M', PAL.lightGrey), fact(segmentLine(o), PAL.white));
    if (o.staminaEmptyM != null) lines.push(emptyLine(o.staminaEmptyM));
    return lines;
  }
  const lost = o.result === 'lose';
  if (o.event === '110mh') {
    const h = hurdlesRow(o.hit ?? 0);
    lines.push(fact(h.text, h.color, true), fumbleLine(o));
    if (lost && fumblesCost(o)) lines.push(fact('FUMBLES COST YOU', PAL.gold));
    else if (lost && (o.hit ?? 0) > 0) lines.push(fact('HURDLES COST YOU', PAL.gold));
    return lines;
  }
  lines.push(fact(paceText(o, o.ms), PAL.white, true), fumbleLine(o));
  if (lost) {
    const need = o.winMs === null ? null : rateToWin(o.ms, o.winMs);
    if (fumblesCost(o)) lines.push(fact('FUMBLES COST YOU', PAL.gold));
    else if (need !== null) lines.push(fact(`+${need.toFixed(1)}/S TO WIN`, PAL.gold));
  }
  return lines;
}

/** How a history entry shows in the records LAST 3 column (design 4.5). */
export function historyCell(e: HistoryEntry): string {
  if (e.result === 'dq') return 'DQ';
  if (e.result === 'dnf') return 'DNF';
  return formatTime(e.ms);
}

/**
 * Place digit after a LAST 3 time (design 29.2.2): the place of a 6-runner race, nothing for DQ, DNF
 * or migrated 2-runner entries.
 */
export function historyPlace(e: HistoryEntry): string {
  if (e.fieldSize !== 6 || e.place === null) return '';
  return String(e.place);
}

export type OptId =
  'volume' | 'muted' | 'reducedFlashing' | 'screenShake' | 'crt' | 'haptics' | 'reset' | 'back';
export type ToggleId = 'muted' | 'reducedFlashing' | 'screenShake' | 'crt' | 'haptics';

export function isToggle(id: OptId): id is ToggleId {
  return (
    id === 'muted' || id === 'reducedFlashing' || id === 'screenShake' || id === 'crt' || id === 'haptics'
  );
}

/** Value column text for an options row. */
export function optionValue(id: OptId, s: Settings): string | null {
  switch (id) {
    case 'volume':
      return `< ${s.volume} >`;
    case 'muted':
    case 'reducedFlashing':
    case 'screenShake':
    case 'crt':
    case 'haptics':
      return s[id] ? 'ON' : 'OFF';
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// v2: events, copy per modality (design 12-18)
// ---------------------------------------------------------------------------

/** Event heading on the ladder (18.3.2) and in the results event-unlock line (18.6). */
export const EVENT_TITLE: Readonly<Record<EventId, string>> = {
  '100m': '100 METRES',
  '110mh': '110M HURDLES',
  '400m': '400 METRES',
};

/** Event card name lines (18.2): `110M` / `HURDLES` on two lines. */
export const EVENT_CARD_NAME: Readonly<Record<EventId, readonly string[]>> = {
  '100m': ['100M'],
  '110mh': ['110M', 'HURDLES'],
  '400m': ['400M'],
};

/** Records tab labels (18.7). */
export const EVENT_TAB: Readonly<Record<EventId, string>> = {
  '100m': '100M',
  '110mh': 'HURDLES',
  '400m': '400M',
};

/** Champion screen title (12.3.2). */
export function championTitle(event: EventId): string {
  return `${EVENT_TAB[event]} CHAMPION`;
}

/** Title prompt (17.6, 17.8.4). */
export function titlePrompt(m: Modality): string {
  return m === 'touch' ? 'TAP TO START' : 'PRESS ENTER';
}

/** Pre-race tip for the first race of an event (13.4.4, 14.3.9), else null. Copy lives in core. */
export function firstRaceTip(event: EventId, m: Modality): string | null {
  return EVENT_COURSE[event].firstRaceTip?.[m] ?? null;
}

/**
 * Results event fact for the hurdles: `CLEAN 10/10` or `KNOCKED n/10`. Never `HIT` for the total,
 * which in-race means one kind of knock only (R4).
 */
export function hurdlesRow(hit: number): { text: string; color: number } {
  return hit === 0
    ? { text: 'CLEAN 10/10', color: PAL.gold }
    : { text: `KNOCKED ${hit}/10`, color: PAL.white };
}

/** Cumulative 400 m splits (18.6): `100 13.92  200 26.10  300 38.25`, `--` for splits not reached. */
export function splitsRow(splits: readonly number[]): string {
  return [100, 200, 300]
    .map((m, i) => {
      const ms = splits[i];
      return `${m} ${ms === undefined ? '--' : formatTime(ms)}`;
    })
    .join('  ');
}

/** HUD split popup (18.4): `200M 26.10`. */
export function splitPopup(index: number, ms: number): string {
  return `${(index + 1) * 100}M ${formatTime(ms)}`;
}

/** Records HIT column (18.7.4): knocked hurdles in the PB race, `-` when unknown or no PB. */
export function hitCell(hit: number | undefined): string {
  return hit === undefined ? '-' : String(hit);
}

// ---------------------------------------------------------------------------
// v3: meets, starter, Gauntlet cards (design 31, 32)
// ---------------------------------------------------------------------------

/** Meet card second line (31.1): `100M FINAL - VS PIP`, or `MEET 3 OF 7 - VS PIP` in Gauntlet. */
export function meetSubtitle(event: EventId, rivalName: string, gauntletTier: number | null): string {
  const head =
    gauntletTier !== null
      ? `MEET ${gauntletTier} OF 7`
      : event === '110mh'
        ? '110M HURDLES FINAL'
        : event === '400m'
          ? '400M FINAL'
          : '100M FINAL';
  return `${head} - VS ${rivalName}`;
}

/** The countdown facts the starter reacts to (design 31.2). */
export interface StarterFacts {
  readonly phase: 'intro' | 'countdown' | 'falseStart' | 'running' | 'finished';
  readonly countdown: 3 | 2 | 1 | 'go' | null;
  readonly falseStarts: number;
  /** The race ended in a DQ (second false start). */
  readonly disqualified: boolean;
}

/** Starter bubble text (31.2), or null for no bubble. */
export function starterBubble(f: StarterFacts): string | null {
  if (f.disqualified) return 'DISQUALIFIED';
  if (f.phase === 'falseStart') return 'FALSE START!';
  if (f.phase !== 'countdown') return null;
  if (f.countdown === 3 || f.countdown === 2) return 'ON YOUR MARKS';
  if (f.countdown === 1) return 'SET';
  return null;
}

/** Gauntlet over card line (32.2): `OUT AT CITY OPEN - 3RD`, `- DQ`, `- DNF`. */
export function gauntletOutLine(meetName: string, outcome: RaceOutcome | null): string {
  if (outcome === null) return `ABANDONED AT ${meetName}`;
  const how = outcome.result === 'dq' ? 'DQ' : outcome.result === 'dnf' ? 'DNF' : ordinal(outcome.place ?? 6);
  return `OUT AT ${meetName} - ${how}`;
}
