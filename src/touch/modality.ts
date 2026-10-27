/**
 * Input modality (design 17.8): touch or keyboard, decided by the last input.
 *
 * Pure part: `initialModality` and `nextModality`. DOM part: `installModality` listens on window
 * (capture phase, so nothing can swallow the events first), writes `<html data-input>` for CSS and
 * updates core's `modality` store for the HUD and menus.
 */
import { modality, type Modality } from '../core/index.ts';

/** Keys that switch to keyboard modality: run, jump and menu keys (not M or F). */
export const MODALITY_KEYS: ReadonlySet<string> = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'KeyA',
  'KeyD',
  'KeyW',
  'KeyS',
  'Enter',
  'NumpadEnter',
  'Space',
  'Escape',
  'Backspace',
  'KeyR',
]);

/** `?touch=1` / `?touch=0` forces the initial modality (debugging and E2E). */
export function initialModality(coarsePointer: boolean, search: string): Modality {
  const force = new URLSearchParams(search).get('touch');
  if (force === '1') return 'touch';
  if (force === '0') return 'keyboard';
  return coarsePointer ? 'touch' : 'keyboard';
}

export type ModalityInput =
  | { readonly kind: 'pointer'; readonly pointerType: string }
  | { readonly kind: 'key'; readonly code: string; readonly trusted: boolean };

export function nextModality(current: Modality, input: ModalityInput): Modality {
  if (input.kind === 'pointer') {
    return input.pointerType === 'touch' || input.pointerType === 'pen' ? 'touch' : current;
  }
  // Synthetic keys (the pause button's Escape) are not the player switching to a keyboard.
  if (!input.trusted) return current;
  return MODALITY_KEYS.has(input.code) ? 'keyboard' : current;
}

/** Wires the reducer to the DOM. Returns a detach function. */
export function installModality(win: Window): () => void {
  const root = win.document.documentElement;
  const apply = (m: Modality): void => {
    root.dataset['input'] = m;
    if (modality.get().modality !== m) modality.set({ modality: m });
  };
  apply(initialModality(win.matchMedia('(pointer: coarse)').matches, win.location.search));

  const onPointer = (e: PointerEvent): void => {
    apply(nextModality(modality.get().modality, { kind: 'pointer', pointerType: e.pointerType }));
  };
  const onKey = (e: KeyboardEvent): void => {
    apply(nextModality(modality.get().modality, { kind: 'key', code: e.code, trusted: e.isTrusted }));
  };
  const opts = { capture: true } as const;
  win.addEventListener('pointerdown', onPointer, opts);
  win.addEventListener('keydown', onKey, opts);
  return () => {
    win.removeEventListener('pointerdown', onPointer, opts);
    win.removeEventListener('keydown', onKey, opts);
  };
}
