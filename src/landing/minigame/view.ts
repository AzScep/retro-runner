/**
 * The hero dash on the page: the race canvas with its HUD and touch pads, a DOS-style console under
 * it (starter calls as log lines, then the result as program output), and every listener. The rules
 * live in session.ts, input.ts, hud.ts and result.ts; this file only wires the DOM to them.
 *
 * Input ownership: run keys are captured (core attachKeyboard, which prevents their default) only
 * while a race is live and on screen, so arrow keys scroll the page at any other time. Enter, Esc
 * and R act only while the dash is on screen and focus is not on another control.
 */
import { attachKeyboard, formatTime, newSeed, type RaceEvent, type RaceState } from '../../core/index.ts';
import { playCue } from '../audio/index.ts';
import { DASH, HERO, PAGE_META } from '../content/index.ts';
import { isRunning, ordinal, PlaceHold, promptFor, starterCall, fitStage, VIEW_H } from './hud.ts';
import { dashKeyAction, padSide, TouchPads, type DashKeyAction } from './input.ts';
import { DashRenderer } from './render.ts';
import { resultCard } from './result.ts';
import { DashSession } from './session.ts';
import type { DashEvent } from './index.ts';
import './dash.css';

type Modality = 'keyboard' | 'touch';

/** Log lines kept under the race; the console is sized for this many. */
const LOG_LINES = 4;
/** Share of the stage that must be on screen for the dash to count as in view. */
const IN_VIEW_RATIO = 0.5;
/** Largest share of the window height the race may take. */
const MAX_HEIGHT_SHARE = 0.6;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class DashView {
  readonly #root = el('div', 'rr-dash');
  /** Bar, stage and console share the stage's width, centred in the host. */
  readonly #frameEl = el('div', 'rr-dash__frame');
  readonly #stage = el('div', 'rr-dash__stage');
  readonly #canvas = el('canvas', 'rr-dash__canvas');
  readonly #time = el('span', 'rr-dash__time');
  readonly #place = el('span', 'rr-dash__place');
  readonly #big = el('span', 'rr-dash__big');
  readonly #prompt = el('span', 'rr-dash__prompt');
  readonly #go = el('button', 'rr-dash__go');
  readonly #goTitle = el('span', 'rr-dash__go-title');
  readonly #goCmd = el('span', 'rr-dash__cmd');
  readonly #log = el('ol', 'rr-dash__log');
  readonly #card = el('div', 'rr-dash__card');
  readonly #live = el('p', 'sr-only');
  readonly #session: DashSession;
  readonly #pads = new TouchPads();
  readonly #reduced: MediaQueryList;
  readonly #coarse: MediaQueryList;
  readonly #observers: { disconnect(): void }[] = [];
  #renderer: DashRenderer | null = null;
  #modality: Modality;
  #viewW = 320;
  /** Enough of the stage on screen to race (keys, Enter, auto-pause). */
  #inView = false;
  /** Any of the stage on screen: worth drawing. */
  #onScreen = false;
  #raf = 0;
  #detachKeys: (() => void) | null = null;
  #placeHold = new PlaceHold();
  #fumblesSinceStep = 0;
  #lastCall: string | null = null;
  #frameEvents: RaceEvent[] = [];
  #destroyed = false;

  constructor(host: HTMLElement, onEvent: (e: DashEvent) => void) {
    this.#reduced = matchMedia('(prefers-reduced-motion: reduce)');
    this.#coarse = matchMedia('(pointer: coarse)');
    this.#modality = this.#coarse.matches ? 'touch' : 'keyboard';
    this.#session = new DashSession({
      onEvent: (e) => {
        this.#onDashEvent(e);
        onEvent(e);
      },
      cue: playCue,
      seed: newSeed,
    });
    this.#build();
    host.append(this.#root);
    this.#listen();
    this.#showReady();
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    cancelAnimationFrame(this.#raf);
    this.#detachKeys?.();
    this.#detachKeys = null;
    for (const o of this.#observers) o.disconnect();
    window.removeEventListener('keydown', this.#onKey, { capture: true });
    window.removeEventListener('blur', this.#onBlur);
    document.removeEventListener('visibilitychange', this.#onVisibility);
    this.#root.remove();
  }

  // ---------------------------------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------------------------------

  #build(): void {
    const root = this.#root;
    root.setAttribute('role', 'group');
    // The sound toggle's M shortcut stays off inside the dash (src/landing/audio).
    root.dataset['rrKeys'] = '';
    root.setAttribute('aria-label', DASH.title);

    const bar = el('div', 'rr-dash__bar');
    bar.append(el('span', 'rr-dash__program', DASH.program), el('span', 'rr-dash__title', DASH.title));

    this.#stage.tabIndex = -1;
    this.#canvas.setAttribute('aria-hidden', 'true');
    this.#canvas.height = VIEW_H;
    const hud = el('div', 'rr-dash__hud');
    hud.setAttribute('aria-hidden', 'true');
    hud.append(this.#time, this.#place, this.#big, this.#prompt);
    const pads = el('div', 'rr-dash__pads');
    pads.setAttribute('aria-hidden', 'true');
    pads.append(el('span', 'rr-dash__pad', DASH.pads.left), el('span', 'rr-dash__pad', DASH.pads.right));
    this.#go.type = 'button';
    const caret = el('span', 'rr-caret');
    caret.setAttribute('aria-hidden', 'true');
    const line = el('span', 'rr-dash__go-line');
    line.append(this.#goCmd, caret);
    this.#go.append(this.#goTitle, line);
    this.#stage.append(this.#canvas, hud, pads, this.#go);

    const console = el('div', 'rr-dash__console');
    this.#log.setAttribute('aria-hidden', 'true');
    this.#card.tabIndex = -1;
    this.#card.hidden = true;
    console.append(this.#log, this.#card);

    this.#live.setAttribute('aria-live', 'polite');
    this.#frameEl.append(bar, this.#stage, console, this.#live);
    root.append(this.#frameEl);
  }

  #setMode(): void {
    this.#root.dataset['mode'] = this.#session.mode;
    this.#root.dataset['modality'] = this.#modality;
  }

  #setModality(m: Modality): void {
    if (m === this.#modality) return;
    this.#modality = m;
    this.#setMode();
    this.#updateGo();
    if (this.#session.mode === 'ready') this.#showReady();
    else if (this.#session.mode === 'result') this.#showResult();
  }

  #updateGo(): void {
    const mode = this.#session.mode;
    const paused = mode === 'paused';
    this.#go.hidden = mode !== 'ready' && !paused;
    this.#goTitle.textContent = paused ? DASH.paused.title : '';
    this.#goTitle.hidden = !paused;
    this.#goCmd.textContent = paused ? DASH.paused[this.#modality] : DASH.startPrompt[this.#modality];
  }

  #logLines(lines: readonly string[], kind: 'note' | 'call' | 'alert'): void {
    for (const text of lines) this.#log.append(el('li', `rr-dash__line rr-dash__line--${kind}`, text));
    while (this.#log.children.length > LOG_LINES) this.#log.firstElementChild?.remove();
  }

  /** Says the lines in the aria-live region, each ending as a sentence. */
  #announce(...lines: readonly string[]): void {
    this.#live.textContent = lines.map((l) => (/[.!?]$/.test(l) ? l : `${l}.`)).join(' ');
  }

  #showReady(): void {
    this.#setMode();
    this.#updateGo();
    this.#log.replaceChildren();
    this.#logLines([DASH.rivalLine, ...DASH.howTo[this.#modality]].slice(0, LOG_LINES), 'note');
  }

  #showResult(): void {
    const outcome = this.#session.outcome;
    if (outcome === null) return;
    const card = resultCard(outcome, DASH);
    const c = this.#card;
    c.replaceChildren();
    c.dataset['kind'] = card.kind;
    c.append(el('p', 'rr-dash__out', card.header), el('p', 'rr-dash__result', card.title));
    if (card.rows.length > 0) {
      const table = el('table', 'rr-dash__table');
      const body = el('tbody', '');
      for (const r of card.rows) {
        const tr = el('tr', r.you ? 'is-you' : '');
        tr.append(el('td', '', r.place), el('td', '', r.name), el('td', 'rr-dash__num', r.time));
        body.append(tr);
      }
      table.append(body);
      c.append(table);
    } else {
      c.append(el('p', 'rr-dash__note', card.line));
    }
    c.append(el('p', 'rr-dash__cta', card.cta));
    const actions = el('div', 'rr-dash__actions');
    const play = el('a', 'rr-btn', HERO.playLabel);
    play.href = PAGE_META.playHref;
    const again = el('button', 'rr-btn rr-btn--secondary', DASH.retryLabel);
    again.type = 'button';
    again.addEventListener('click', () => this.#start());
    actions.append(play, again);
    c.append(actions);
    for (const hint of DASH.retryHint[this.#modality]) c.append(el('p', 'rr-dash__hint', hint));
    c.hidden = false;
    this.#log.hidden = true;
  }

  // ---------------------------------------------------------------------------------------------
  // Flow
  // ---------------------------------------------------------------------------------------------

  #start(): void {
    const focusInside = this.#root.contains(document.activeElement);
    if (!this.#session.start(performance.now())) return;
    this.#renderer?.reset();
    this.#placeHold = new PlaceHold();
    this.#fumblesSinceStep = 0;
    this.#lastCall = null;
    this.#card.hidden = true;
    this.#log.hidden = false;
    this.#log.replaceChildren();
    this.#setMode();
    this.#updateGo();
    // The start button or the card just hid; keep focus in the dash without scrolling the page.
    if (focusInside || document.activeElement === document.body) this.#stage.focus({ preventScroll: true });
    this.#syncCapture();
    this.#syncLoop();
  }

  #pause(): void {
    if (!this.#session.pause(performance.now())) return;
    this.#setMode();
    this.#updateGo();
    this.#syncCapture();
    this.#announce(DASH.paused.title);
  }

  #resume(): void {
    if (!this.#session.resume(performance.now())) return;
    this.#setMode();
    this.#updateGo();
    this.#stage.focus({ preventScroll: true });
    this.#syncCapture();
  }

  #onDashEvent(e: DashEvent): void {
    if (e.type === 'falseStart') {
      const count = this.#session.state?.falseStarts ?? 1;
      const lines = count < 2 ? [DASH.falseStart.title, DASH.falseStart.line] : [DASH.falseStart.title];
      this.#logLines(lines, 'alert');
      this.#announce(...lines);
    } else if (e.type === 'disqualified') {
      this.#logLines([DASH.disqualified.title], 'alert');
      this.#announce(DASH.disqualified.title, DASH.disqualified.line);
    }
  }

  /** Run keys belong to the dash only while a race is live and on screen. */
  #syncCapture(): void {
    const want = this.#session.capturing && this.#inView && document.visibilityState === 'visible';
    if (want && this.#detachKeys === null) {
      this.#detachKeys = attachKeyboard(window, (e) => {
        this.#setModality('keyboard');
        this.#session.input(e);
      });
    } else if (!want && this.#detachKeys !== null) {
      this.#detachKeys();
      this.#detachKeys = null;
      this.#session.release('k', performance.now());
    }
    if (!this.#session.capturing) {
      this.#pads.clear();
      this.#session.release('t', performance.now());
    }
    this.#stage.classList.toggle('is-live', this.#session.capturing);
  }

  // ---------------------------------------------------------------------------------------------
  // Listeners
  // ---------------------------------------------------------------------------------------------

  #listen(): void {
    this.#go.addEventListener('click', () => {
      if (this.#session.mode === 'paused') this.#resume();
      else this.#start();
    });

    const stage = this.#stage;
    stage.addEventListener('pointerdown', (ev) => {
      if (ev.pointerType === 'touch' || ev.pointerType === 'pen') this.#setModality('touch');
      if (!this.#session.capturing || ev.button !== 0) return;
      ev.preventDefault();
      // Capture keeps a finger that slides across the middle on its own pad until it lifts.
      if (stage.isConnected) {
        try {
          stage.setPointerCapture(ev.pointerId);
        } catch {
          // The pointer is already gone (lifted before this ran): the press still counts.
        }
      }
      const r = stage.getBoundingClientRect();
      const e = this.#pads.down(ev.pointerId, padSide(ev.clientX - r.left, r.width), ev.timeStamp);
      if (e) this.#session.input(e);
    });
    const lift = (ev: PointerEvent): void => {
      const e = this.#pads.up(ev.pointerId, ev.timeStamp);
      if (e) this.#session.input(e);
    };
    stage.addEventListener('pointerup', lift);
    stage.addEventListener('pointercancel', lift);
    stage.addEventListener('lostpointercapture', lift);
    // No long-press menu or text selection on the pads.
    stage.addEventListener('contextmenu', (ev) => {
      if (this.#session.capturing) ev.preventDefault();
    });

    window.addEventListener('keydown', this.#onKey, { capture: true });
    window.addEventListener('blur', this.#onBlur);
    document.addEventListener('visibilitychange', this.#onVisibility);

    const io = new IntersectionObserver(
      ([entry]) => {
        this.#onScreen = entry !== undefined && entry.isIntersecting;
        this.#inView = this.#onScreen && (entry?.intersectionRatio ?? 0) >= IN_VIEW_RATIO;
        if (!this.#inView) this.#pause();
        this.#syncCapture();
        this.#syncLoop();
      },
      { threshold: [0, IN_VIEW_RATIO, 1] },
    );
    io.observe(stage);
    const ro = new ResizeObserver(() => this.#fit());
    ro.observe(this.#root);
    this.#observers.push(io, ro);
    this.#fit();
  }

  readonly #onKey = (ev: KeyboardEvent): void => {
    // Mid-race, M must not toggle the sound (the toggle skips prevented keys); capture phase so
    // this runs before it.
    if (this.#session.capturing && (ev.key === 'm' || ev.key === 'M')) ev.preventDefault();
    if (ev.key === 'Enter' || ev.key.toLowerCase() === 'r' || ev.key === 'Escape') {
      const active = document.activeElement;
      const focusFree =
        active === null ||
        active === document.body ||
        (this.#root.contains(active) && !active.matches('a, button, input, select, textarea'));
      const action = dashKeyAction({
        key: ev.key,
        repeat: ev.repeat,
        modified: ev.ctrlKey || ev.altKey || ev.metaKey,
        mode: this.#session.mode,
        inView: this.#inView,
        focusFree,
      });
      if (action !== null) {
        ev.preventDefault();
        this.#setModality('keyboard');
        this.#act(action);
      }
    }
  };

  #act(action: DashKeyAction): void {
    if (action === 'start' || action === 'retry') this.#start();
    else if (action === 'resume') this.#resume();
    else this.#pause();
  }

  readonly #onBlur = (): void => this.#pause();
  readonly #onVisibility = (): void => {
    if (document.visibilityState === 'hidden') this.#pause();
    this.#syncCapture();
    this.#syncLoop();
  };

  #fit(): void {
    const width = this.#root.clientWidth;
    if (width <= 0) return;
    const f = fitStage(width, window.innerHeight * MAX_HEIGHT_SHARE, window.devicePixelRatio || 1);
    this.#viewW = f.viewW;
    this.#canvas.width = f.viewW;
    this.#frameEl.style.width = `${f.cssW}px`;
    this.#stage.style.height = `${f.cssH}px`;
    this.#root.style.setProperty('--rr-dash-px', String(f.cssPx));
    this.#draw(performance.now());
  }

  // ---------------------------------------------------------------------------------------------
  // Frames
  // ---------------------------------------------------------------------------------------------

  /** Draws while the dash is on screen in a visible tab; nothing runs off screen. */
  #syncLoop(): void {
    const want = this.#onScreen && document.visibilityState === 'visible' && !this.#destroyed;
    if (want && this.#raf === 0) this.#raf = requestAnimationFrame(this.#frame);
    else if (!want && this.#raf !== 0) {
      cancelAnimationFrame(this.#raf);
      this.#raf = 0;
    }
  }

  readonly #frame = (): void => {
    this.#raf = 0;
    const now = performance.now();
    const before = this.#session.mode;
    this.#frameEvents = [...this.#session.advance(now)];
    this.#draw(now);
    if (before === 'live' && this.#session.mode === 'result') this.#finish();
    this.#syncCapture();
    this.#syncLoop();
  };

  #finish(): void {
    this.#setMode();
    this.#updateGo();
    this.#showResult();
    const o = this.#session.outcome;
    if (o !== null) {
      const card = resultCard(o, DASH);
      this.#announce(card.title, card.line, card.cta);
    }
    this.#card.focus({ preventScroll: true });
  }

  #draw(now: number): void {
    if (this.#renderer === null) {
      if (!this.#onScreen) return;
      // Baking the six runners takes a few frames' worth of time: only once the dash is seen.
      this.#renderer = new DashRenderer(this.#canvas);
    }
    const state = this.#session.state;
    this.#renderer.draw(state, this.#frameEvents, now, this.#viewW);
    this.#hud(state, now);
    this.#frameEvents = [];
  }

  #hud(state: RaceState | null, now: number): void {
    if (state === null) {
      this.#time.textContent = '';
      this.#place.textContent = '';
      this.#big.textContent = '';
      this.#prompt.textContent = '';
      return;
    }
    for (const e of this.#frameEvents) {
      if (e.type === 'fumble') this.#fumblesSinceStep++;
      else if (e.type === 'step') this.#fumblesSinceStep = 0;
      else if (e.type === 'beat' && e.beat === 'go') this.#call(DASH.countdown[3]);
    }
    const live = this.#session.mode === 'live';
    const call = starterCall(state.phase, state.countdown);
    if (live && call !== null) this.#call(DASH.starter[call]);
    if (state.phase === 'falseStart') this.#lastCall = null;

    this.#time.textContent = formatTime(state.timerMs);
    const crossed = state.player.finishMs !== null;
    const place = this.#placeHold.update(state.livePlace, now, crossed);
    this.#place.textContent = place === null ? '' : ordinal(place);
    this.#place.dataset['place'] = place === null ? '' : String(Math.min(place, 4));

    let big = '';
    if (state.outcome?.result === 'dq') big = DASH.disqualified.title;
    else if (state.phase === 'falseStart') big = DASH.falseStart.title;
    else if (state.countdown === 'go') big = DASH.countdown[3];
    else if (state.countdown !== null && state.phase === 'countdown')
      big = DASH.countdown[3 - state.countdown] ?? '';
    if (this.#session.mode === 'result') big = '';
    this.#big.textContent = big;
    this.#big.dataset['size'] = big.length > 3 ? 'word' : 'digit';

    const prompt = promptFor({
      running: live && isRunning(state),
      idleMs: state.idleMs,
      fumblesSinceStep: this.#fumblesSinceStep,
      reducedMotion: this.#reduced.matches,
    });
    this.#prompt.textContent = prompt === 'mash' ? DASH.mash : prompt === 'alternate' ? DASH.alternate : '';
    this.#prompt.dataset['prompt'] = prompt ?? '';
  }

  /** A starter call, logged and announced once each time it changes. */
  #call(text: string): void {
    if (text === this.#lastCall) return;
    this.#lastCall = text;
    this.#logLines([text], 'call');
    this.#announce(text);
  }
}
