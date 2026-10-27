/**
 * Keyboard mapping for menus (design 8). Uses `event.code` so layouts do not matter.
 * Run keys during a race are handled by core's attachKeyboard, not here.
 */

export type MenuAction = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'retry';

const CODE_TO_ACTION: Readonly<Record<string, MenuAction>> = {
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
  Enter: 'confirm',
  NumpadEnter: 'confirm',
  Space: 'confirm',
  Escape: 'back',
  Backspace: 'back',
  KeyR: 'retry',
};

/**
 * Maps a keydown to a menu action. Auto-repeat is honoured only for direction keys (holding Down
 * scrolls), never for confirm/back/retry, so a held Enter cannot skip through several screens.
 */
export function menuAction(code: string, repeat: boolean): MenuAction | null {
  const action = CODE_TO_ACTION[code] ?? null;
  if (action === null) return null;
  if (repeat && action !== 'up' && action !== 'down' && action !== 'left' && action !== 'right') return null;
  return action;
}

/** Keys whose browser default (scrolling, history back) is always prevented (design 8.9). */
export const PREVENT_DEFAULT_CODES: ReadonlySet<string> = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'Backspace',
  'PageUp',
  'PageDown',
  'Home',
  'End',
]);
