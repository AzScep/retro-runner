/**
 * Per-visitor memory of the landing page (badges, the boot log seen). localStorage can be missing
 * or throw (private windows, blocked site data), so every access is guarded and the page works
 * without it: a failed read is null and a failed write is dropped.
 */

/** The slice of `Storage` the page uses, so tests can pass a fake. */
export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>;

export const STORAGE_KEYS = {
  badges: 'retro-runner.landing.badges',
  booted: 'retro-runner.landing.booted',
} as const;

function defaultStore(): KeyValueStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

export function readKey(key: string, store: KeyValueStore | null = defaultStore()): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeKey(key: string, value: string, store: KeyValueStore | null = defaultStore()): void {
  try {
    store?.setItem(key, value);
  } catch {
    // Quota or blocked storage: the page simply forgets on reload.
  }
}
