/**
 * Touch layer (design 17, research-mobile): a DOM overlay over the canvas that turns fingers into
 * race input, draws the pads from the race feed, maps canvas taps to menu tap targets, and handles
 * the platform bits (rotate prompt, Android fullscreen, iPhone hint, haptics, audio unlock).
 *
 * Imported only by src/main.ts. Talks to the game through core's `raceInput`, `raceFeed` and
 * `modality`, ART's `touchArtUrl` and UI's `dispatchTap`; no scene knows about touch.
 */
import { GAME_HEIGHT, GAME_WIDTH } from '../art/index.ts';
import {
  modality,
  raceFeed,
  raceInput,
  type RaceEvent,
  type RaceInput,
  type RaceState,
  type Settings,
} from '../core/index.ts';
import { dispatchTap } from '../ui/tapTargets.ts';
import { hapticPattern, vibrator } from './haptics.ts';
import { computeLayout, toGamePx, type Rect } from './layout.ts';
import { installModality } from './modality.ts';
import { Overlay } from './overlay.ts';
import { HIDDEN_FRAME, PadStates, type PadFrame } from './padState.ts';
import {
  androidFullscreen,
  isAndroid,
  readPlatform,
  wantsHomeScreenHint,
  wantsRotatePrompt,
} from './platform.ts';
import { PointerMap, type Control } from './pointerMap.ts';
import { readSafeArea } from './safeArea.ts';
import './touch.css';

export { readSafeArea } from './safeArea.ts';

export interface TouchHandle {
  relayout(canvasRect: DOMRect, gamePx: number): void;
  detach(): void;
}

export interface TouchOptions {
  readonly canvas: HTMLCanvasElement;
  readonly unlockAudio: () => void;
  readonly getSettings: () => Settings;
  readonly setHint: (name: 'addToHomeScreen', v: boolean) => void;
  /** The Add to Home Screen hint may show now: the save is loaded, it was never dismissed, and the Title is up. */
  readonly hintDue: () => boolean;
}

export function installTouch(opts: TouchOptions): TouchHandle {
  const win = window;
  const doc = document;
  const { canvas } = opts;
  const cleanups: (() => void)[] = [];
  const on = <K extends keyof WindowEventMap>(
    target: Window,
    type: K,
    fn: (e: WindowEventMap[K]) => void,
    options: AddEventListenerOptions = {},
  ): void => {
    target.addEventListener(type, fn, options);
    cleanups.push(() => target.removeEventListener(type, fn, options));
  };

  cleanups.push(installModality(win));
  const overlay = new Overlay(doc);
  const map = new PointerMap();
  const padStates = new PadStates();
  const platform = readPlatform(win);
  const vib = vibrator(win.navigator);

  let lastState: RaceState | null = null;
  /** Set by anything that pauses the race (Esc, pause button, blur, portrait) until the race publishes unpaused. */
  let localPaused = false;
  let canvasRect: Rect = { x: 0, y: 0, w: 0, h: 0 };
  let gamePx = 1;
  let hurdlesLaid: boolean | null = null;

  const reducedFlashing = (): boolean => opts.getSettings().reducedFlashing;
  const reduceMotionQuery = win.matchMedia('(prefers-reduced-motion: reduce)');
  /** The rotate prompt's turning phone is motion too: static with reduced flashing or the OS setting. */
  const stillArt = (): boolean => reducedFlashing() || reduceMotionQuery.matches;
  const emit = (events: readonly RaceInput[]): void => {
    for (const e of events) raceInput.emit(e);
  };

  // --- Layout -------------------------------------------------------------------------------
  const layout = (hurdles: boolean): void => {
    hurdlesLaid = hurdles;
    const l = computeLayout({
      viewW: win.innerWidth,
      viewH: win.innerHeight,
      insets: readSafeArea(doc),
      canvas: canvasRect,
      gamePx,
      hurdles,
    });
    overlay.applyLayout(l, gamePx, hurdles);
    if (modality.get().padsOverCanvas !== l.padsOverCanvas)
      modality.set({ padsOverCanvas: l.padsOverCanvas });
  };

  // --- Rendering ----------------------------------------------------------------------------
  const frameFor = (state: RaceState | null, events: readonly RaceEvent[], consume: boolean): PadFrame => {
    const effective = state && localPaused ? { ...state, paused: true } : state;
    return padStates.frame(effective, events, (c) => map.held(c), reducedFlashing(), consume);
  };
  const render = (frame: PadFrame): void => {
    const hurdles = lastState?.event === '110mh';
    if (hurdles !== hurdlesLaid) layout(hurdles);
    const s = lastState;
    const showPause =
      s !== null && !s.paused && !localPaused && s.outcome === null && s.player.finishMs === null;
    overlay.render(frame, showPause);
  };
  const rerender = (): void => render(frameFor(lastState, [], false));

  cleanups.push(
    raceFeed.subscribe((state, events) => {
      lastState = state;
      if (state === null || !state.paused) localPaused = false;
      if (state === null) {
        render(HIDDEN_FRAME);
        return;
      }
      render(frameFor(state, events, true));
      if (vib && opts.getSettings().haptics) {
        const pattern = hapticPattern(events);
        if (pattern) vib.vibrate([...pattern]);
      }
    }),
  );

  // --- Run and jump zones -------------------------------------------------------------------
  const release = (e: PointerEvent): void => {
    if (!map.tracks(e.pointerId)) return;
    emit(map.release(e.pointerId, e.timeStamp, performance.now()));
    rerender();
  };
  for (const c of ['L', 'R', 'jump'] as const satisfies readonly Control[]) {
    const zone = overlay.zones[c];
    zone.addEventListener('pointerdown', (e) => {
      // No focus change, no compatibility mouse events.
      e.preventDefault();
      try {
        zone.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic pointers (tests) have no active pointer to capture.
      }
      const r = map.down(e.pointerId, c, e.timeStamp, performance.now());
      if (r.blocked) padStates.flashBlocked(c);
      emit(r.events);
      rerender();
    });
    zone.addEventListener('pointerup', release);
    zone.addEventListener('pointercancel', release);
    zone.addEventListener('lostpointercapture', release);
  }
  // Safety net when capture was not possible: a tracked finger lifting anywhere still releases.
  on(win, 'pointerup', release, { capture: true });
  on(win, 'pointercancel', release, { capture: true });

  const releaseAll = (t: number): void => {
    emit(map.releaseAll(t, performance.now()));
    if (lastState) localPaused = true;
    rerender();
  };
  on(
    win,
    'blur',
    (e) => {
      if (e.target === win) releaseAll(e.timeStamp);
    },
    { capture: true },
  );
  const onVisibility = (e: Event): void => {
    if (doc.visibilityState === 'hidden') releaseAll(e.timeStamp);
  };
  doc.addEventListener('visibilitychange', onVisibility);
  cleanups.push(() => doc.removeEventListener('visibilitychange', onVisibility));
  on(
    win,
    'keydown',
    (e) => {
      if (e.code === 'Escape' && lastState) {
        localPaused = true;
        rerender();
      }
    },
    { capture: true },
  );

  // --- Pause button: a synthetic Escape, which the race already handles -----------------------
  overlay.pause.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    overlay.setPausePressed(true);
    win.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true }));
  });
  const unpress = (): void => overlay.setPausePressed(false);
  overlay.pause.addEventListener('pointerup', unpress);
  overlay.pause.addEventListener('pointercancel', unpress);
  overlay.pause.addEventListener('pointerleave', unpress);

  // --- Menu taps: canvas pointerup -> game px -> UI tap targets -------------------------------
  const canvasDowns = new Set<number>();
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || e.pointerType === 'pen') canvasDowns.add(e.pointerId);
  });
  canvas.addEventListener('pointercancel', (e) => canvasDowns.delete(e.pointerId));
  canvas.addEventListener('pointerup', (e) => {
    if (!canvasDowns.delete(e.pointerId) || overlay.hintVisible) return;
    const r = canvas.getBoundingClientRect();
    const p = toGamePx(
      e.clientX,
      e.clientY,
      { x: r.left, y: r.top, w: r.width, h: r.height },
      GAME_WIDTH,
      GAME_HEIGHT,
    );
    if (p) dispatchTap(p.x, p.y);
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // --- Activation-gated work on release: audio, Android fullscreen, iPhone hint --------------
  let fullscreenTried = false;
  let hintShown = false;
  const onActivation = (e: Event): void => {
    opts.unlockAudio();
    if (e instanceof PointerEvent && e.pointerType === 'mouse') return;
    if (!fullscreenTried) {
      fullscreenTried = true;
      if (isAndroid(platform)) androidFullscreen(win);
    }
    // The hint belongs to the Title (17.6). It opens in this capture-phase handler, before the
    // canvas sees the release, so this tap only opens the hint and does not also start the game
    // (the canvas handler drops taps while the hint is up); the next tap after OK starts.
    if (!hintShown && wantsHomeScreenHint(platform) && opts.hintDue()) {
      hintShown = true;
      overlay.showHint(canvasRect, gamePx, () => opts.setHint('addToHomeScreen', true));
    }
  };
  on(win, 'pointerup', onActivation, { capture: true });
  on(win, 'touchend', onActivation, { capture: true });
  on(
    win,
    'contextmenu',
    (e) => {
      if (modality.get().modality === 'touch') e.preventDefault();
    },
    { capture: true },
  );

  // --- Rotate prompt: portrait on a touch device releases every finger and auto-pauses --------
  const portrait = win.matchMedia('(orientation: portrait)');
  const coarse = win.matchMedia('(pointer: coarse)');
  let rotateShown = false;
  const updateRotate = (): void => {
    const show = wantsRotatePrompt({
      portrait: portrait.matches,
      coarse: coarse.matches,
      modality: modality.get().modality,
    });
    if (show && !rotateShown) {
      // Blur-equivalent: the race and the keyboard adapter treat it like the window losing focus.
      win.dispatchEvent(new Event('blur'));
    }
    if (show !== rotateShown) overlay.setRotate(show, stillArt());
    rotateShown = show;
  };
  for (const q of [portrait, coarse]) {
    q.addEventListener('change', updateRotate);
    cleanups.push(() => q.removeEventListener('change', updateRotate));
  }
  cleanups.push(modality.subscribe(updateRotate));
  updateRotate();

  return {
    relayout(rect: DOMRect, px: number): void {
      canvasRect = { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
      gamePx = px;
      doc.documentElement.style.setProperty('--gp', `${px}px`);
      layout(lastState?.event === '110mh');
      updateRotate();
    },
    detach(): void {
      emit(map.releaseAll(performance.now(), performance.now()));
      for (const c of cleanups.splice(0)) c();
      overlay.destroy();
    },
  };
}
