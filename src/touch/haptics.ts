/**
 * Haptics (design 17.7): short pulses on fumble, false start and a hurdle HIT, never per step.
 * Only where `navigator.vibrate` exists (Chrome Android) and the HAPTICS setting is on.
 */
import type { RaceEvent } from '../core/index.ts';

export const PULSE = {
  fumble: [30],
  falseStart: [40, 60, 40],
  hurdleHit: [40],
} as const;

/** The vibration pattern for one frame's race events, or null for none (the strongest wins). */
export function hapticPattern(events: readonly RaceEvent[]): readonly number[] | null {
  let out: readonly number[] | null = null;
  for (const e of events) {
    if (e.type === 'falseStart') return PULSE.falseStart;
    if (e.type === 'hurdleHit' && e.lane === 0) out = PULSE.hurdleHit;
    else if (e.type === 'fumble' && out === null) out = PULSE.fumble;
  }
  return out;
}

export interface Vibrator {
  vibrate(pattern: number | number[]): boolean;
}

export function vibrator(nav: Navigator): Vibrator | null {
  return typeof nav.vibrate === 'function' ? { vibrate: (p) => nav.vibrate(p) } : null;
}
