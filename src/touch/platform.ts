/**
 * Platform specifics (design 17.6, research-mobile 3-4): which device we are on, Android
 * fullscreen plus landscape lock on the first tap, and the iPhone Add to Home Screen hint test.
 */

export interface PlatformFacts {
  readonly userAgent: string;
  /** `(pointer: coarse)` */
  readonly coarse: boolean;
  /** Element fullscreen can actually be requested (not just `fullscreenEnabled`). */
  readonly canRequestFullscreen: boolean;
  /** Running as a Home Screen web app (standalone or fullscreen display mode). */
  readonly standalone: boolean;
}

export function isAndroid(f: PlatformFacts): boolean {
  return /Android/i.test(f.userAgent);
}

/**
 * Rotate prompt (17.6): portrait on a device whose primary pointer is a finger, while the player is
 * using touch. A touchscreen laptop or a touch monitor has a fine primary pointer (`any-pointer:
 * coarse` alone is not enough), and a phone driven from a keyboard has keyboard modality: both get
 * the letterboxed game instead of a prompt they cannot act on.
 */
export function wantsRotatePrompt(s: {
  readonly portrait: boolean;
  /** `(pointer: coarse)`, read live (an iPad gains a fine pointer with a trackpad). */
  readonly coarse: boolean;
  readonly modality: 'touch' | 'keyboard';
}): boolean {
  return s.portrait && s.coarse && s.modality === 'touch';
}

/** iPhone Safari tab: coarse pointer, no element fullscreen, not a Home Screen app (17.6). */
export function wantsHomeScreenHint(f: PlatformFacts): boolean {
  return f.coarse && !f.canRequestFullscreen && !f.standalone && /iPhone|iPod/i.test(f.userAgent);
}

interface WebkitRoot {
  webkitRequestFullscreen?: () => unknown;
}
interface StandaloneNavigator {
  readonly standalone?: boolean;
}

export function readPlatform(win: Window): PlatformFacts {
  const root = win.document.documentElement as HTMLElement & WebkitRoot;
  const mq = (q: string): boolean => win.matchMedia(q).matches;
  return {
    userAgent: win.navigator.userAgent,
    coarse: mq('(pointer: coarse)'),
    canRequestFullscreen:
      typeof root.requestFullscreen === 'function' || typeof root.webkitRequestFullscreen === 'function',
    standalone:
      mq('(display-mode: standalone)') ||
      mq('(display-mode: fullscreen)') ||
      (win.navigator as Navigator & StandaloneNavigator).standalone === true,
  };
}

interface LockableOrientation {
  lock?: (o: 'landscape') => Promise<void>;
}

/**
 * Android Chrome: fullscreen with hidden navigation UI, then lock landscape. Must run inside a
 * user activation (pointerup, not pointerdown). Failures leave the game windowed, which is fine.
 */
export function androidFullscreen(win: Window): void {
  const doc = win.document;
  if (doc.fullscreenElement || typeof doc.documentElement.requestFullscreen !== 'function') return;
  doc.documentElement
    .requestFullscreen({ navigationUI: 'hide' })
    .then(async () => {
      const o = win.screen.orientation as ScreenOrientation & LockableOrientation;
      await o.lock?.('landscape');
    })
    .catch(() => {});
}
