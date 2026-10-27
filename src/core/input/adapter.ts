import type { RaceInput, Side } from '../index.ts';

// DOM keyboard adapter (with platform/, the only browser-facing code in src/core).

type Slot = Side | 'jump';

const CODE_TO_SLOT: Readonly<Record<string, Slot>> = {
  ArrowLeft: 'L',
  KeyA: 'L',
  ArrowRight: 'R',
  KeyD: 'R',
  ArrowUp: 'jump',
  KeyW: 'jump',
};

const SLOTS: readonly Slot[] = ['L', 'R', 'jump'];

function make(slot: Slot, kind: 'down' | 'up', t: number, repeat: boolean): RaceInput {
  return slot === 'jump' ? { kind, action: 'jump', t, repeat } : { kind, side: slot, t, repeat };
}

/**
 * Listens on `target` (capture phase) for ArrowLeft/KeyA, ArrowRight/KeyD and ArrowUp/KeyW by
 * `event.code`, prevents their default action and forwards RaceInputs stamped with `event.timeStamp`.
 *
 * Held rule across sources (contract "Input"): a fresh 'down' is forwarded only for the first key
 * of a side (or of jump) and an 'up' only when the last key of it is released, so holding A and
 * tapping ArrowLeft forwards nothing. Auto-repeat keydowns are forwarded with `repeat: true`; the
 * race ignores them and they never change held counts.
 *
 * Window blur: browsers drop the keyup of a key released while the page is unfocused, which would
 * leave that side "held" forever and make the runner unable to step. On blur every held slot gets
 * a synthetic 'up' at the blur's timestamp. This cannot be exploited: a key still physically held
 * on return only produces auto-repeat keydowns (repeat === true), which never count.
 *
 * Returns a detach function.
 */
export function attachKeyboard(target: Window, onEvent: (e: RaceInput) => void): () => void {
  const down: Record<Slot, Set<string>> = { L: new Set(), R: new Set(), jump: new Set() };

  const onKeyDown = (ev: KeyboardEvent): void => {
    const slot = CODE_TO_SLOT[ev.code];
    if (slot === undefined) return;
    ev.preventDefault();
    const codes = down[slot];
    if (ev.repeat) {
      onEvent(make(slot, 'down', ev.timeStamp, true));
      return;
    }
    if (codes.has(ev.code)) return; // a lost keyup: the key is already counted
    codes.add(ev.code);
    if (codes.size === 1) onEvent(make(slot, 'down', ev.timeStamp, false));
  };

  const onKeyUp = (ev: KeyboardEvent): void => {
    const slot = CODE_TO_SLOT[ev.code];
    if (slot === undefined) return;
    ev.preventDefault();
    const codes = down[slot];
    if (!codes.delete(ev.code)) return;
    if (codes.size === 0) onEvent(make(slot, 'up', ev.timeStamp, false));
  };

  const onBlur = (ev: Event): void => {
    // Capture-phase listeners also see element blurs; only the window losing focus matters.
    if (ev.target !== target) return;
    for (const slot of SLOTS) {
      if (down[slot].size === 0) continue;
      down[slot].clear();
      onEvent(make(slot, 'up', ev.timeStamp, false));
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
