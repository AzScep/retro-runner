/// <reference types="vite-plugin-pwa/client" />
/**
 * Entry point: Phaser game at 320x180 scaled to fill the window at 16:9 inside the safe area
 * (design 5.1, 17), fullscreen toggle, global keyboard rules (design 8), the touch layer
 * (design 17), the service worker (research-mobile 5) and the test hook in test builds (research 2).
 */
import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from './art/index.ts';
import { unlockAudio } from './audio/index.ts';
import { attachKeyboard, raceInput, type Settings } from './core/index.ts';
import { getApp, hasApp, settings, toggleMute } from './scenes/app.ts';
import { BootScene } from './scenes/BootScene.ts';
import { ChampionScene } from './scenes/ChampionScene.ts';
import { HudScene } from './scenes/HudScene.ts';
import { LadderScene } from './scenes/LadderScene.ts';
import { OptionsScene } from './scenes/OptionsScene.ts';
import { PauseScene } from './scenes/PauseScene.ts';
import { RaceScene } from './scenes/RaceScene.ts';
import { RecordsScene } from './scenes/RecordsScene.ts';
import { ResultsScene } from './scenes/ResultsScene.ts';
import { installTestHook } from './scenes/testHook.ts';
import { EventSelectScene } from './scenes/EventSelectScene.ts';
import { TitleScene } from './scenes/TitleScene.ts';
import { installTouch, readSafeArea, type TouchHandle } from './touch/index.ts';
import { installFullscreen } from './ui/fullscreen.ts';
import { fitZoom } from './ui/hudMath.ts';
import { PREVENT_DEFAULT_CODES } from './ui/keys.ts';

const parent = document.getElementById('app');
if (!parent) throw new Error('#app missing from index.html');

const game = new Phaser.Game({
  type: Phaser.WEBGL,
  parent,
  width: GAME_WIDTH,
  height: GAME_HEIGHT,
  // Letterbox colour, palette index 1 (#0b0b14).
  backgroundColor: '#0b0b14',
  pixelArt: true,
  roundPixels: true,
  antialias: false,
  banner: false,
  disableContextMenu: true,
  // Scenes read keys from window listeners (scenes/app.ts onKeyDown); Phaser's keyboard plugin
  // would ignore events that core's run-key adapter already preventDefault()ed. Pointer input is
  // the touch layer's DOM overlay and canvas-tap mapping (research-mobile 2): Phaser's touch
  // manager would preventDefault canvas touches and its cached bounds go stale after fitCanvas.
  input: { keyboard: false, mouse: false, touch: false, gamepad: false },
  // Audio is engine-free Web Audio in src/audio; Phaser's sound manager stays off.
  audio: { noAudio: true },
  scale: {
    mode: Phaser.Scale.NONE,
    autoCenter: Phaser.Scale.NO_CENTER,
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
  },
  // Scene order is render order: race overlays sit above RaceScene.
  scene: [
    BootScene,
    TitleScene,
    EventSelectScene,
    LadderScene,
    RecordsScene,
    OptionsScene,
    ChampionScene,
    RaceScene,
    HudScene,
    ResultsScene,
    PauseScene,
  ],
});

let touch: TouchHandle | null = null;

/**
 * Largest 16:9 size that fits inside the safe area (env(safe-area-inset-*), zero on desktop),
 * snapped and centred on whole device pixels (design 5.1). Then the touch controls follow.
 */
function fitCanvas(): void {
  const canvas = game.canvas;
  if (!canvas) return;
  const dpr = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  const inset = readSafeArea();
  const snap = (v: number): number => Math.round(v * dpr) / dpr;
  const left = snap(inset.left);
  const top = snap(inset.top);
  const w = Math.max(1, window.innerWidth - left - snap(inset.right));
  const h = Math.max(1, window.innerHeight - top - snap(inset.bottom));
  const z = fitZoom(w, h, dpr, GAME_WIDTH, GAME_HEIGHT);
  game.scale.setZoom(z.zoom);
  canvas.style.width = `${z.cssWidth}px`;
  canvas.style.height = `${z.cssHeight}px`;
  canvas.style.left = `${left + z.cssLeft}px`;
  canvas.style.top = `${top + z.cssTop}px`;
  touch?.relayout(
    new DOMRect(left + z.cssLeft, top + z.cssTop, z.cssWidth, z.cssHeight),
    z.cssWidth / GAME_WIDTH,
  );
}

/** Settings before BootScene has loaded the save (haptics on, as the save default). */
const DEFAULT_SETTINGS: Settings = {
  volume: 8,
  muted: false,
  reducedFlashing: false,
  screenShake: true,
  crt: false,
  haptics: true,
};

game.events.once(Phaser.Core.Events.READY, () => {
  const canvas = game.canvas;
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Retro Runner game');
  touch = installTouch({
    canvas,
    unlockAudio,
    getSettings: () => (hasApp() ? settings() : DEFAULT_SETTINGS),
    setHint: (name, v) => {
      if (hasApp()) getApp().records.setHint(name, v);
    },
    // Before the save is loaded the hint waits (it is shown after the first tap anyway).
    hintSeen: () => !hasApp() || getApp().records.data.hints.addToHomeScreen,
  });
  fitCanvas();
  canvas.focus();
});
window.addEventListener('resize', fitCanvas);
// Mobile toolbars and on-screen UI change the visual viewport without always firing resize.
window.visualViewport?.addEventListener('resize', fitCanvas);
// devicePixelRatio changes (browser zoom, moving between monitors) do not always fire resize.
let dprQuery: MediaQueryList | null = null;
const watchDpr = (): void => {
  dprQuery?.removeEventListener('change', onDprChange);
  dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  dprQuery.addEventListener('change', onDprChange);
};
const onDprChange = (): void => {
  fitCanvas();
  watchDpr();
};
watchDpr();
window.addEventListener('pointerdown', () => game.canvas?.focus());
installFullscreen(() => game.canvas?.focus());
// Entering or leaving fullscreen resizes the window, but refit explicitly in case resize lags.
document.addEventListener('fullscreenchange', fitCanvas);

// Run and jump keys feed the app-wide race input hub, once for the app's lifetime (attaching per
// scene would double-count presses); RaceScene only subscribes to raceInput, as the touch layer emits.
attachKeyboard(window, raceInput.emit);

// Global keys (design 8): never scroll the page, unlock audio on the first key, M mutes everywhere.
window.addEventListener(
  'keydown',
  (e) => {
    if (PREVENT_DEFAULT_CODES.has(e.code)) e.preventDefault();
    unlockAudio();
    if (e.code === 'KeyM' && !e.repeat && hasApp()) toggleMute(game);
  },
  { capture: true },
);

if (import.meta.env.VITE_TEST_HOOKS === '1') installTestHook(game);

// Offline play from the Home Screen (research-mobile 5). `prompt` mode: a new version waits and
// takes over on the next cold launch, never mid-race. Never in test builds or dev.
if (import.meta.env.PROD && import.meta.env.VITE_TEST_HOOKS !== '1') {
  void import('virtual:pwa-register').then(({ registerSW }) => registerSW({ immediate: true }));
}
