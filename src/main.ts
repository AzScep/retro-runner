/**
 * Entry point: Phaser game at 320x180 scaled to fill the window at 16:9 (design 5.1), fullscreen
 * toggle, global keyboard rules (design 8) and the test hook in test builds (research 2).
 */
import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from './art/index.ts';
import { unlockAudio } from './audio/index.ts';
import { hasApp, toggleMute } from './scenes/app.ts';
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
import { TitleScene } from './scenes/TitleScene.ts';
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
  // would ignore events that core's run-key adapter already preventDefault()ed.
  input: { keyboard: false },
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

/** Largest 16:9 size that fits, snapped and centred on whole device pixels (design 5.1). */
function fitCanvas(): void {
  const canvas = game.canvas;
  if (!canvas) return;
  const z = fitZoom(window.innerWidth, window.innerHeight, window.devicePixelRatio, GAME_WIDTH, GAME_HEIGHT);
  game.scale.setZoom(z.zoom);
  canvas.style.width = `${z.cssWidth}px`;
  canvas.style.height = `${z.cssHeight}px`;
  canvas.style.left = `${z.cssLeft}px`;
  canvas.style.top = `${z.cssTop}px`;
}

game.events.once(Phaser.Core.Events.READY, () => {
  const canvas = game.canvas;
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Retro Runner game');
  fitCanvas();
  canvas.focus();
});
window.addEventListener('resize', fitCanvas);
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
