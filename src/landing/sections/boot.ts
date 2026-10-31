/**
 * The BIOS POST log typed over the hero on a visitor's first load. Decorative (aria-hidden): the
 * hero is fully in the DOM underneath, so it costs no content, focus or layout. At most about
 * 1.5 s, gone on any key, click or tap, and shown once per visitor. Under reduced motion the log
 * appears whole, without typing, and clears the same way.
 */
import { TERMINAL } from '../content/index.ts';
import { readKey, STORAGE_KEYS, writeKey } from '../hud/storage.ts';
import { el, reducedMotion } from './dom.ts';

const TYPE_MS = 1150;
const HOLD_MS = 350;
const REDUCED_HOLD_MS = 1200;

export function mountBoot(over: HTMLElement): void {
  if (readKey(STORAGE_KEYS.booted) !== null) return;
  writeKey(STORAGE_KEYS.booted, '1');

  const lines = TERMINAL.boot.map(() => el('p', { class: 'rr-boot__line' }));
  const caret = el('span', { class: 'rr-caret' });
  const log = el(
    'div',
    { class: 'rr-boot', attrs: { 'aria-hidden': 'true' } },
    el('div', { class: 'rr-container' }, ...lines),
  );
  over.append(log);

  const total = TERMINAL.boot.reduce((n, s) => n + s.length, 0);
  let timer = 0;
  let start = 0;
  const end = () => {
    cancelAnimationFrame(timer);
    clearTimeout(timer);
    log.remove();
    removeEventListener('keydown', end, true);
    removeEventListener('pointerdown', end, true);
  };
  addEventListener('keydown', end, true);
  addEventListener('pointerdown', end, true);

  // Writes the first `chars` characters across the lines, with the caret at the write head.
  const draw = (chars: number) => {
    let left = chars;
    let head: HTMLElement | undefined;
    TERMINAL.boot.forEach((text, i) => {
      const line = lines[i] as HTMLElement;
      line.textContent = text.slice(0, Math.max(0, left));
      if (head === undefined && (left < text.length || i === lines.length - 1)) head = line;
      left -= text.length;
    });
    head?.append(caret);
  };

  if (reducedMotion()) {
    draw(total);
    timer = window.setTimeout(end, REDUCED_HOLD_MS);
    return;
  }
  const step = (now: number) => {
    start ||= now;
    const chars = Math.ceil(((now - start) / TYPE_MS) * total);
    draw(chars);
    if (chars < total) timer = requestAnimationFrame(step);
    else timer = window.setTimeout(end, HOLD_MS);
  };
  timer = requestAnimationFrame(step);
}
