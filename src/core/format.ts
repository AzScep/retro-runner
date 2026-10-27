/** Hundredths of a second, rounded up (design 4.1.3). The epsilon absorbs float noise from tick times. */
function ceilHundredths(ms: number): number {
  return Math.max(0, Math.ceil(ms / 10 - 1e-7));
}

function hundredthsToString(h: number, padSeconds: number): string {
  const s = Math.floor(h / 100);
  const hh = h % 100;
  return `${String(s).padStart(padSeconds, '0')}.${String(hh).padStart(2, '0')}`;
}

/** M:SS.hh from hundredths (design 14.4). */
function minutesString(h: number): string {
  const m = Math.floor(h / 6000);
  return `${m}:${hundredthsToString(h % 6000, 2)}`;
}

/** Hundredths at which the display switches to M:SS.hh (60.00 s). */
const LONG_FROM_H = 6000;

export function formatTime(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '--.--';
  const h = ceilHundredths(ms);
  return h >= LONG_FROM_H ? minutesString(h) : hundredthsToString(h, 2);
}

export function formatLadderTotal(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '-:--.--';
  return minutesString(ceilHundredths(ms));
}

export function formatMargin(ms: number): string {
  const sign = ms < 0 ? '-' : '+';
  const h = ceilHundredths(Math.abs(ms));
  return sign + (h >= LONG_FROM_H ? minutesString(h) : hundredthsToString(h, 1));
}

export function toKmh(vMps: number): number {
  return Math.round(vMps * 3.6);
}
