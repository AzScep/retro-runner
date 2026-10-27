/** Pure text rules for screens (results card, records table, options rows). No Phaser. */
import {
  EVENT_COURSE,
  formatTime,
  type EventId,
  type HistoryEntry,
  type Modality,
  type RaceOutcome,
  type Settings,
} from '../core/index.ts';
import { PAL } from './hudMath.ts';

/** Title text and colour for an outcome (design 6.6). */
export function resultTitle(outcome: RaceOutcome): { text: string; color: number } {
  switch (outcome.result) {
    case 'win':
      return outcome.photoFinish
        ? { text: 'PHOTO FINISH', color: PAL.gold }
        : { text: 'YOU WIN!', color: PAL.gold };
    case 'lose':
      return { text: 'YOU LOSE', color: PAL.red };
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

/** How a history entry shows in the records LAST 3 column (design 4.5). */
export function historyCell(e: HistoryEntry): string {
  if (e.result === 'dq') return 'DQ';
  if (e.result === 'dnf') return 'DNF';
  return formatTime(e.ms);
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

/** Results event row for the hurdles (18.6): CLEAN RACE! or HURDLES HIT n/10. */
export function hurdlesRow(hit: number): { text: string; color: number } {
  return hit === 0
    ? { text: 'CLEAN RACE!', color: PAL.gold }
    : { text: `HURDLES HIT ${hit}/10`, color: PAL.white };
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
