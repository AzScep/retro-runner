/**
 * App-wide state shared by scenes: the records store, ladder cursor, one-shot flags and the
 * test-hook seed override. Created once by BootScene.
 */
import Phaser from 'phaser';
import { OPPONENT_IDS, type OpponentId, type Race, type RecordsStore, type Settings } from '../core/index.ts';
import { setCrt } from '../art/index.ts';
import { setMuted, setVolume } from '../audio/index.ts';
import { menuAction, type MenuAction } from '../ui/keys.ts';

export const SceneKey = {
  Boot: 'Boot',
  Title: 'Title',
  Ladder: 'Ladder',
  Records: 'Records',
  Options: 'Options',
  Champion: 'Champion',
  Race: 'Race',
  Hud: 'Hud',
  Results: 'Results',
  Pause: 'Pause',
} as const;
export type SceneKey = (typeof SceneKey)[keyof typeof SceneKey];

/** Scenes that run in parallel on top of Race. */
export const RACE_OVERLAYS: readonly SceneKey[] = [SceneKey.Hud, SceneKey.Results, SceneKey.Pause];

export interface App {
  readonly records: RecordsStore;
  /** Rival selected on the Ladder Map. */
  ladderCursor: OpponentId;
  /** Set by the first Zyx win; Ladder shows the Champion screen once when it is set. */
  championPending: boolean;
  /** "RECORDS WILL NOT BE SAVED" is shown once per session. */
  saveWarningShown: boolean;
  /** Test hook override for the next race seed. */
  pendingSeed: number | null;
  /** The live race (for the test hook), null outside S3/S4. */
  race: Race | null;
}

let app: App | null = null;

export function initApp(records: RecordsStore): App {
  const highest = [...OPPONENT_IDS].reverse().find((id) => records.isUnlocked(id)) ?? 'pip';
  app = {
    records,
    ladderCursor: highest,
    championPending: false,
    saveWarningShown: false,
    pendingSeed: null,
    race: null,
  };
  applyAudioSettings();
  return app;
}

export function getApp(): App {
  if (!app) throw new Error('App not initialised: BootScene must run first');
  return app;
}

export function hasApp(): boolean {
  return app !== null;
}

export function settings(): Settings {
  return getApp().records.data.settings;
}

export function applyAudioSettings(): void {
  const s = settings();
  setVolume(s.volume);
  setMuted(s.muted);
}

/** Event name on game.events fired after any settings change (mute icon, options rows). */
export const SETTINGS_CHANGED = 'rr-settings-changed';

export function updateSettings(game: Phaser.Game, patch: Partial<Settings>): void {
  getApp().records.updateSettings(patch);
  applyAudioSettings();
  game.events.emit(SETTINGS_CHANGED);
}

export function toggleMute(game: Phaser.Game): void {
  updateSettings(game, { muted: !settings().muted });
}

/** Applies the optional CRT post-effect to a scene's main camera per settings. */
export function applyCrt(scene: Phaser.Scene): void {
  setCrt(scene.cameras.main, settings().crt);
}

/**
 * Stops every race overlay (and Race) that is running, then starts `key` (which stops `from`).
 * Scene operations are queued by Phaser and run in order at the start of the next step.
 */
export function goTo(from: Phaser.Scene, key: SceneKey, data?: object): void {
  const mgr = from.scene;
  for (const k of [SceneKey.Race, ...RACE_OVERLAYS]) {
    if (k === from.scene.key) continue;
    if (mgr.isActive(k) || mgr.isPaused(k) || mgr.isSleeping(k)) mgr.stop(k);
  }
  mgr.start(key, data);
}

/**
 * Window keydown listener for the lifetime of a scene, delivered only while the scene is running
 * (not paused, sleeping or shut down).
 *
 * Phaser's KeyboardPlugin is deliberately not used: it drops events whose default was prevented
 * (core's run-key adapter and our page-scroll guard prevent arrows in the capture phase), and it
 * replays its per-frame queue to scenes started in the same frame. Plain DOM listeners avoid both.
 */
export function onKeyDown(scene: Phaser.Scene, handler: (e: KeyboardEvent) => void): void {
  const listener = (e: KeyboardEvent): void => {
    if (scene.sys.isActive()) handler(e);
  };
  window.addEventListener('keydown', listener);
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => window.removeEventListener('keydown', listener));
}

/** Menu actions (design 8) for the lifetime of the scene. */
export function onMenuKeys(
  scene: Phaser.Scene,
  handler: (action: MenuAction, e: KeyboardEvent) => void,
): void {
  onKeyDown(scene, (e) => {
    const action = menuAction(e.code, e.repeat);
    if (action) handler(action, e);
  });
}

export function nextOpponent(id: OpponentId): OpponentId | null {
  const i = OPPONENT_IDS.indexOf(id);
  return OPPONENT_IDS[i + 1] ?? null;
}

export function previousOpponent(id: OpponentId): OpponentId | null {
  const i = OPPONENT_IDS.indexOf(id);
  return i > 0 ? (OPPONENT_IDS[i - 1] ?? null) : null;
}
