import type { KeyValueStorage } from '../index.ts';

// Browser platform access (DOM allowed here, see eslint.config.js).

/** window.localStorage if a probe write succeeds, else null. Returns null in Node (no window). */
export function browserStorage(): KeyValueStorage | null {
  try {
    if (typeof window === 'undefined') return null;
    const ls = window.localStorage;
    if (ls === null || ls === undefined) return null;
    const probe = 'retroRunner.probe';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}
