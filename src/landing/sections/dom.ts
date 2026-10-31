/**
 * Small DOM helpers shared by the landing sections: element building, first-view hooks, the
 * typed prompt lines and the PLAY button. Nothing here knows about a particular section.
 */
import { PAGE_META, TERMINAL, type ModalityLines } from '../content/index.ts';
import { playCue } from '../audio/index.ts';

type Child = Node | string | null | undefined | false;

export interface ElOptions {
  readonly class?: string;
  readonly text?: string;
  readonly attrs?: Readonly<Record<string, string>>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: ElOptions = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text !== undefined) node.textContent = opts.text;
  for (const [k, v] of Object.entries(opts.attrs ?? {})) node.setAttribute(k, v);
  for (const c of children) if (c) node.append(c);
  return node;
}

let reducedQuery: MediaQueryList | null = null;

export function reducedMotion(): boolean {
  reducedQuery ??= matchMedia('(prefers-reduced-motion: reduce)');
  return reducedQuery.matches;
}

/** A touch-first visitor gets the tap lines of the copy; everyone else the keyboard lines. */
export function isTouch(): boolean {
  return matchMedia('(pointer: coarse)').matches;
}

export function modalityLines(lines: ModalityLines): readonly string[] {
  return isTouch() ? lines.touch : lines.keyboard;
}

/** Runs `fn` once, the first time `target` comes within `margin` of the viewport. */
export function onceVisible(
  target: Element,
  fn: () => void,
  opts: { readonly margin?: string; readonly threshold?: number } = {},
): void {
  const io = new IntersectionObserver(
    (entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      fn();
    },
    { rootMargin: opts.margin ?? '0px', threshold: opts.threshold ?? 0 },
  );
  io.observe(target);
}

/** Lazy-create heavy art: called when `target` is within 600 px of the viewport. */
export function onApproach(target: Element, fn: () => void): void {
  onceVisible(target, fn, { margin: '600px 0px' });
}

/** A bracketed status tag such as [OK]; `kind` picks its colour. */
export function statusTag(kind: keyof typeof TERMINAL.tags): HTMLSpanElement {
  return el('span', { class: `rr-tag rr-tag--${kind}`, text: TERMINAL.tags[kind] });
}

const TYPE_MS = 28;

/**
 * A line that types itself in with a block caret the first time it scrolls into view. The full text
 * is in the DOM from the start for screen readers and search; the typed copy is aria-hidden, and
 * the untyped rest stays laid out (invisible), so nothing shifts. Static under reduced motion.
 */
export function typedLine<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text: string,
  className = '',
  opts: { readonly keepCaret?: boolean } = {},
): HTMLElementTagNameMap[K] {
  const done = el('span', { attrs: { 'aria-hidden': 'true' } });
  const caret = el('span', { class: 'rr-caret', attrs: { 'aria-hidden': 'true' } });
  const rest = el('span', { class: 'rr-type__rest', text, attrs: { 'aria-hidden': 'true' } });
  const line = el(
    tag,
    { class: `rr-type ${className}`.trim() },
    el('span', { class: 'sr-only', text }),
    done,
    caret,
    rest,
  );
  const finish = () => {
    done.textContent = text;
    rest.textContent = '';
    if (!opts.keepCaret) caret.remove();
  };
  if (reducedMotion()) {
    finish();
    return line;
  }
  onceVisible(
    line,
    () => {
      let i = 0;
      const timer = setInterval(() => {
        i++;
        done.textContent = text.slice(0, i);
        rest.textContent = text.slice(i);
        if (i >= text.length) {
          clearInterval(timer);
          finish();
        }
      }, TYPE_MS);
    },
    { threshold: 0.5 },
  );
  return line;
}

/** Section head: the DOS prompt and command as a typed eyebrow, then the h2. */
export function sectionHead(eyebrow: string, title: string, headingId: string): HTMLElement {
  return el(
    'div',
    { class: 'rr-section__head' },
    typedLine('p', `${TERMINAL.prompt} ${eyebrow}`, 'rr-prompt', { keepCaret: true }),
    el('h2', { text: title, attrs: { id: headingId } }),
  );
}

/** The page's primary CTA: a large arcade button to the game, with an optional sub line. */
export function playButton(
  label: string,
  opts: { readonly sub?: string; readonly coin?: boolean } = {},
): HTMLAnchorElement {
  const a = el(
    'a',
    {
      class: `rr-btn rr-btn--lg${opts.coin ? ' rr-btn--coin' : ''}`,
      attrs: { href: PAGE_META.playHref },
    },
    el('span', { text: label }),
    opts.sub ? el('span', { class: 'rr-btn__sub', text: opts.sub }) : null,
  );
  a.addEventListener('click', () => playCue('coin'));
  return a;
}

/** A `section.rr-section > .rr-container` labelled by its h2. */
export function section(id: string, className = ''): { section: HTMLElement; inner: HTMLElement } {
  const inner = el('div', { class: 'rr-container' });
  const s = el(
    'section',
    { class: `rr-section ${className}`.trim(), attrs: { id, 'aria-labelledby': `${id}-title` } },
    inner,
  );
  return { section: s, inner };
}

export function track(finish = false): HTMLElement {
  return el('div', {
    class: `rr-track${finish ? ' rr-track--finish' : ''}`,
    attrs: { 'aria-hidden': 'true' },
  });
}
