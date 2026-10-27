import { describe, expect, it } from 'vitest';
import type { RunKeyEvent } from '../index.ts';
import { attachKeyboard } from '../index.ts';

/** Node has EventTarget and Event but no KeyboardEvent: build look-alikes with the fields used. */
function key(type: 'keydown' | 'keyup', code: string, timeStamp: number, repeat = false): Event {
  const ev = new Event(type, { cancelable: true });
  Object.defineProperty(ev, 'code', { value: code });
  Object.defineProperty(ev, 'repeat', { value: repeat });
  Object.defineProperty(ev, 'timeStamp', { value: timeStamp });
  return ev;
}

function blur(timeStamp: number): Event {
  const ev = new Event('blur');
  Object.defineProperty(ev, 'timeStamp', { value: timeStamp });
  return ev;
}

function setup(): { target: EventTarget; got: RunKeyEvent[]; detach: () => void } {
  const target = new EventTarget();
  const got: RunKeyEvent[] = [];
  const detach = attachKeyboard(target as unknown as Window, (e) => got.push(e));
  return { target, got, detach };
}

describe('attachKeyboard', () => {
  it('maps ArrowLeft/KeyA to L and ArrowRight/KeyD to R by code, with timeStamp and repeat', () => {
    const { target, got } = setup();
    target.dispatchEvent(key('keydown', 'ArrowLeft', 10));
    target.dispatchEvent(key('keyup', 'ArrowLeft', 20));
    target.dispatchEvent(key('keydown', 'KeyD', 30, true));
    target.dispatchEvent(key('keydown', 'KeyA', 40));
    target.dispatchEvent(key('keydown', 'ArrowRight', 50));
    expect(got).toEqual([
      { kind: 'down', side: 'L', t: 10, repeat: false },
      { kind: 'up', side: 'L', t: 20, repeat: false },
      { kind: 'down', side: 'R', t: 30, repeat: true },
      { kind: 'down', side: 'L', t: 40, repeat: false },
      { kind: 'down', side: 'R', t: 50, repeat: false },
    ]);
  });

  it('prevents the default action of run keys only', () => {
    const { target } = setup();
    const run = key('keydown', 'ArrowRight', 1);
    const other = key('keydown', 'Enter', 2);
    target.dispatchEvent(run);
    target.dispatchEvent(other);
    expect(run.defaultPrevented).toBe(true);
    expect(other.defaultPrevented).toBe(false);
  });

  it('sends a side up only when the last key of that side is released', () => {
    const { target, got } = setup();
    target.dispatchEvent(key('keydown', 'KeyA', 1));
    target.dispatchEvent(key('keydown', 'ArrowLeft', 2));
    target.dispatchEvent(key('keyup', 'ArrowLeft', 3));
    expect(got.filter((e) => e.kind === 'up')).toEqual([]);
    target.dispatchEvent(key('keyup', 'KeyA', 4));
    expect(got.filter((e) => e.kind === 'up')).toEqual([{ kind: 'up', side: 'L', t: 4, repeat: false }]);
  });

  it('synthesises keyups for held sides on window blur', () => {
    const { target, got } = setup();
    target.dispatchEvent(key('keydown', 'KeyD', 1));
    target.dispatchEvent(blur(5));
    target.dispatchEvent(blur(6));
    expect(got.slice(1)).toEqual([{ kind: 'up', side: 'R', t: 5, repeat: false }]);
  });

  it('detach removes every listener', () => {
    const { target, got, detach } = setup();
    detach();
    target.dispatchEvent(key('keydown', 'KeyA', 1));
    expect(got).toEqual([]);
  });
});
