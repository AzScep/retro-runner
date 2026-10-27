import type { RunKeyEvent, Side } from '../index.ts';

// DOM keyboard adapter (with platform/, the only browser-facing code in src/core).

const CODE_TO_SIDE: Readonly<Record<string, Side>> = {
  ArrowLeft: 'L',
  KeyA: 'L',
  ArrowRight: 'R',
  KeyD: 'R',
};

/**
 * Listens on `target` (capture phase) for ArrowLeft/KeyA and ArrowRight/KeyD by `event.code`,
 * prevents their default action and forwards RunKeyEvents stamped with `event.timeStamp`.
 *
 * Sides, not keys: a 'down' is forwarded for every keydown (so the race can see repeats and
 * same-side chords), but an 'up' only when the last key of that side is released. Holding A and
 * releasing ArrowLeft therefore keeps the left side held, as design 2.2.3 requires.
 *
 * Window blur: browsers drop the keyup of a key released while the page is unfocused, which would
 * leave that side "held" forever and make the runner unable to step. On blur every held side gets
 * a synthetic 'up' at the blur's timestamp. This cannot be exploited: a key still physically held
 * on return only produces auto-repeat keydowns (repeat === true), which never count as steps.
 *
 * Returns a detach function.
 */
export function attachKeyboard(target: Window, onEvent: (e: RunKeyEvent) => void): () => void {
  const down: Record<Side, Set<string>> = { L: new Set(), R: new Set() };

  const onKeyDown = (ev: KeyboardEvent): void => {
    const side = CODE_TO_SIDE[ev.code];
    if (side === undefined) return;
    ev.preventDefault();
    down[side].add(ev.code);
    onEvent({ kind: 'down', side, t: ev.timeStamp, repeat: ev.repeat });
  };

  const onKeyUp = (ev: KeyboardEvent): void => {
    const side = CODE_TO_SIDE[ev.code];
    if (side === undefined) return;
    ev.preventDefault();
    const codes = down[side];
    codes.delete(ev.code);
    if (codes.size === 0) onEvent({ kind: 'up', side, t: ev.timeStamp, repeat: false });
  };

  const onBlur = (ev: Event): void => {
    // Capture-phase listeners also see element blurs; only the window losing focus matters.
    if (ev.target !== target) return;
    for (const side of ['L', 'R'] as const) {
      if (down[side].size === 0) continue;
      down[side].clear();
      onEvent({ kind: 'up', side, t: ev.timeStamp, repeat: false });
    }
  };

  const opts = { capture: true } as const;
  target.addEventListener('keydown', onKeyDown, opts);
  target.addEventListener('keyup', onKeyUp, opts);
  target.addEventListener('blur', onBlur, opts);
  return () => {
    target.removeEventListener('keydown', onKeyDown, opts);
    target.removeEventListener('keyup', onKeyUp, opts);
    target.removeEventListener('blur', onBlur, opts);
  };
}
