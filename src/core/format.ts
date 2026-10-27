/** Hundredths of a second, rounded up (design 4.1.3). The epsilon absorbs float noise from tick times. */
function ceilHundredths(ms: number): number {
  return Math.max(0, Math.ceil(ms / 10 - 1e-7));
}

function hundredthsToString(h: number, padSeconds: number): string {
  const s = Math.floor(h / 100);
  const hh = h % 100;
  return `${String(s).padStart(padSeconds, '0')}.${String(hh).padStart(2, '0')}`;
}

export function formatTime(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return '--.--';
  return hundredthsToString(ceilHundredths(ms), 2);
}

export function formatMargin(ms: number): string {
  const sign = ms < 0 ? '-' : '+';
  return sign + hundredthsToString(ceilHundredths(Math.abs(ms)), 1);
}

export function toKmh(vMps: number): number {
  return Math.round(vMps * 3.6);
}
