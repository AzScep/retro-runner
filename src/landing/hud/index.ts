/**
 * The game layer of the landing page: a pinned DOS-style status line (1UP score, sections seen,
 * badges, sound), the badge list it opens, and the achievement toasts. Rules live in badges.ts;
 * this file only draws them and remembers earned badges per visitor (storage.ts).
 */
import { HUD, TERMINAL, type BadgeId } from '../content/index.ts';
import { mountSoundToggle, playCue } from '../audio/index.ts';
import type { DashEvent } from '../minigame/index.ts';
import { BadgeBook, countUp, dashBadge, parseSaved, scoreDigits, serialize } from './badges.ts';
import { readKey, STORAGE_KEYS, writeKey } from './storage.ts';

/** What the sections see of the game layer. */
export interface Game {
  has(id: BadgeId): boolean;
  /** Earns `id` once: score, toast, sound and storage. Later calls do nothing. */
  earn(id: BadgeId): void;
  /** Called after each new badge. */
  onEarn(fn: (id: BadgeId) => void): void;
  /** Feeds a hero dash event in (start, false start, win). */
  dash(e: DashEvent): void;
  /** Watches a section for the progress meter. */
  track(section: HTMLElement): void;
}

export interface HudMount {
  readonly header: HTMLElement;
  /** Toasts and the live region; append to body. */
  readonly overlay: readonly HTMLElement[];
  readonly game: Game;
}

const COUNT_MS = 800;
const TOAST_MS = 4500;
const MAX_TOASTS = 3;

function node<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text !== undefined) n.textContent = text;
  return n;
}

function reduced(): boolean {
  return matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function mountHud(sectionCount: number): HudMount {
  const book = new BadgeBook(HUD.list, parseSaved(readKey(STORAGE_KEYS.badges), HUD.list));
  const listeners: ((id: BadgeId) => void)[] = [];

  // ---- Status line ----
  const header = node('header', 'rr-hud rr-status');
  const inner = node('div', 'rr-container rr-hud__inner');
  header.append(inner);

  const [oneUp = HUD.player, ...name] = HUD.player.split(' ');
  const score = node('p', 'rr-hud__score rr-status__cell');
  const value = node('span', 'rr-hud__value', scoreDigits(book.score));
  value.setAttribute('aria-hidden', 'true');
  const scoreText = node('span', 'sr-only');
  score.append(
    node('span', 'rr-hud__label', oneUp),
    node('span', 'rr-hud__label rr-status__wide', name.join(' ')),
    scoreText,
    value,
  );

  const progress = node('div', 'rr-status__cell rr-status__progress');
  const meter = node('div', 'rr-meter');
  meter.setAttribute('role', 'progressbar');
  meter.setAttribute('aria-label', HUD.progressLabel);
  meter.setAttribute('aria-valuemin', '0');
  meter.setAttribute('aria-valuemax', String(sectionCount));
  meter.append(node('div', 'rr-meter__fill'));
  const seenCount = node('span', 'rr-status__count rr-status__wide');
  seenCount.setAttribute('aria-hidden', 'true');
  progress.append(node('span', 'rr-status__label rr-status__wide', HUD.progressLabel), meter, seenCount);

  const badges = node('div', 'rr-status__cell rr-status__badges');
  const slots = node('span', 'rr-hud__badges rr-status__slots');
  slots.setAttribute('aria-hidden', 'true');
  const slotOf = new Map<BadgeId, HTMLElement>();
  for (const b of HUD.list) {
    const li = node('span', 'rr-badge');
    slots.append(li);
    slotOf.set(b.id, li);
  }
  const toggle = node('button', 'rr-status__toggle');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'rr-badge-list');
  const badgeCount = node('span', 'rr-status__count');
  const word = node('span', 'rr-status__label rr-status__wide rr-status__word', HUD.badges);
  word.setAttribute('aria-hidden', 'true');
  toggle.append(word, slots, badgeCount);
  badges.append(toggle);

  const sound = node('div', 'rr-status__cell rr-hud__sound');
  inner.append(score, progress, badges, sound);
  mountSoundToggle(sound);

  // ---- Badge list ----
  const list = node('div', 'rr-panel rr-badge-list');
  list.id = 'rr-badge-list';
  list.hidden = true;
  list.setAttribute('role', 'region');
  list.setAttribute('aria-label', HUD.badges);
  const rows = node('ul', 'rr-badge-list__rows');
  const done = node('p', 'rr-badge-list__done', HUD.allEarned);
  list.append(node('p', 'rr-prompt', `${TERMINAL.prompt} BADGES.EXE`), rows, done);
  header.append(list);

  const setOpen = (open: boolean, refocus = false) => {
    list.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (!open && refocus) toggle.focus();
  };
  toggle.addEventListener('click', () => {
    setOpen(list.hidden === true);
    playCue('select');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !list.hidden) setOpen(false, true);
  });
  document.addEventListener('pointerdown', (e) => {
    if (!list.hidden && e.target instanceof Node && !badges.contains(e.target) && !list.contains(e.target)) {
      setOpen(false);
    }
  });

  // ---- Toasts ----
  const stack = node('div', 'rr-toast-stack');
  stack.setAttribute('aria-hidden', 'true');
  const live = node('div', 'sr-only');
  live.setAttribute('aria-live', 'polite');

  const dismiss = (t: HTMLElement) => {
    if (reduced()) return t.remove();
    t.classList.add('is-leaving');
    t.addEventListener('animationend', () => t.remove(), { once: true });
  };
  const toast = (title: string, line: string, text: string) => {
    const t = node('div', 'rr-toast rr-log');
    const body = node('div');
    body.append(node('p', 'rr-toast__title', title), node('p', 'rr-log__line', line));
    if (text) body.append(node('p', 'rr-toast__text', text));
    t.append(body);
    stack.append(t);
    while (stack.children.length > MAX_TOASTS) stack.firstElementChild?.remove();
    setTimeout(() => dismiss(t), TOAST_MS);
  };

  // ---- Drawing ----
  let shown = book.score;
  let countFrom = shown;
  let countStart = 0;
  let raf = 0;
  const drawScore = (n: number) => {
    shown = n;
    value.textContent = scoreDigits(n);
  };
  const countTo = (target: number) => {
    scoreText.textContent = `${HUD.score} ${target}`;
    if (reduced()) return drawScore(target);
    countFrom = shown;
    countStart = performance.now();
    cancelAnimationFrame(raf);
    const step = (now: number) => {
      drawScore(countUp(countFrom, target, now - countStart, COUNT_MS));
      if (shown !== target) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  };

  const drawBadges = () => {
    badgeCount.textContent = HUD.progress(book.count, book.total);
    toggle.setAttribute('aria-label', `${HUD.badges} ${badgeCount.textContent}`);
    rows.replaceChildren(
      ...HUD.list.map((b) => {
        const have = book.has(b.id);
        slotOf.get(b.id)?.classList.toggle('rr-badge--earned', have);
        const li = node('li', `rr-badge-list__row${have ? ' is-earned' : ''}`);
        const tag = node(
          'span',
          `rr-tag rr-tag--${have ? 'ok' : 'locked'}`,
          have ? TERMINAL.tags.ok : TERMINAL.tags.locked,
        );
        li.append(
          tag,
          node('span', 'rr-badge-list__name', have ? b.name : b.lockedName),
          node('span', 'rr-badge-list__points', `+${b.points}`),
          node('span', 'rr-badge-list__how', have ? b.earned : b.how),
        );
        return li;
      }),
    );
    done.hidden = !book.complete;
  };

  const seen = new Set<Element>();
  const drawProgress = () => {
    meter.style.setProperty('--rr-meter-value', String(seen.size / sectionCount));
    meter.setAttribute('aria-valuenow', String(seen.size));
    meter.setAttribute('aria-valuetext', HUD.progress(seen.size, sectionCount));
    seenCount.textContent = HUD.progress(seen.size, sectionCount);
  };
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) if (e.isIntersecting) seen.add(e.target);
      drawProgress();
    },
    // Seen once a section crosses the middle third of the screen.
    { rootMargin: '-33% 0px -33% 0px' },
  );

  scoreText.textContent = `${HUD.score} ${book.score}`;
  drawBadges();
  drawProgress();

  const game: Game = {
    has: (id) => book.has(id),
    earn(id) {
      const badge = book.earn(id);
      if (!badge) return;
      writeKey(STORAGE_KEYS.badges, serialize(book));
      const line = `${badge.name} (+${badge.points})`;
      toast(HUD.toastTitle, line, badge.earned);
      live.textContent = `${HUD.toastTitle} ${line}. ${badge.earned}`;
      if (book.complete) {
        toast(HUD.toastTitle, HUD.allEarned, '');
        live.textContent += ` ${HUD.allEarned}`;
      }
      playCue('badge');
      countTo(book.score);
      drawBadges();
      for (const fn of listeners) fn(id);
    },
    onEarn: (fn) => void listeners.push(fn),
    dash(e) {
      const id = dashBadge(e);
      if (id) game.earn(id);
    },
    track: (s) => io.observe(s),
  };

  return { header, overlay: [stack, live], game };
}
