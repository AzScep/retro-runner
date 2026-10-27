/** Pure text rules for screens (results card, records table, options rows). No Phaser. */
import { formatTime, type HistoryEntry, type RaceOutcome, type Settings } from '../core/index.ts';
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

export type OptId = 'volume' | 'muted' | 'reducedFlashing' | 'screenShake' | 'crt' | 'reset' | 'back';
export type ToggleId = 'muted' | 'reducedFlashing' | 'screenShake' | 'crt';

export function isToggle(id: OptId): id is ToggleId {
  return id === 'muted' || id === 'reducedFlashing' || id === 'screenShake' || id === 'crt';
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
      return s[id] ? 'ON' : 'OFF';
    default:
      return null;
  }
}
