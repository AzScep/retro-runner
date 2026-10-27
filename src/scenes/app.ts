/**
 * App-wide state shared by scenes: the records store, ladder cursor, one-shot flags and the
 * test-hook seed override. Created once by BootScene.
 */
import Phaser from 'phaser';
import {
  EVENT_IDS,
  LADDERS,
  ladderEntry,
  modality,
  nextRival,
  type EventId,
  type ModalityState,
  type OpponentId,
  type Race,
  type RecordsStore,
  type Settings,
} from '../core/index.ts';
import { setCrt } from '../art/index.ts';
import { setMuted, setVolume, type MusicId } from '../audio/index.ts';
import { menuAction, type MenuAction } from '../ui/keys.ts';

export const SceneKey = {
  Boot: 'Boot',
  Title: 'Title',
  Events: 'Events',
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
  /** Event of the ladder, race and results on screen (S2-S5, S9). */
  event: EventId;
  /** Rival selected on each event's Ladder Map. */
  ladderCursor: Record<EventId, OpponentId>;
  /** Set by the first tier 7 win of an event; that event's Ladder shows its Champion screen once. */
  championPending: EventId | null;
  /** "RECORDS WILL NOT BE SAVED" is shown once per session. */
  saveWarningShown: boolean;
  /** Test hook override for the next race seed. */
  pendingSeed: number | null;
  /** The live race (for the test hook), null outside S3/S4. */
  race: Race | null;
}

let app: App | null = null;

/** Highest unlocked rival of an event's ladder. */
function highestUnlocked(records: RecordsStore, event: EventId): OpponentId {
  return [...ladderIds(event)].reverse().find((id) => records.isUnlocked(event, id)) ?? 'pip';
}

function initialCursors(records: RecordsStore): Record<EventId, OpponentId> {
  const out = {} as Record<EventId, OpponentId>;
  for (const e of EVENT_IDS) out[e] = highestUnlocked(records, e);
  return out;
}

export function initApp(records: RecordsStore): App {
  app = {
    records,
    event: records.data.lastEvent,
    ladderCursor: initialCursors(records),
    championPending: null,
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

/** After "reset records": every cursor back to Pip, nothing pending (design 16.4 rule 5). */
export function resetRecords(game: Phaser.Game): void {
  const a = getApp();
  a.records.reset();
  a.event = '100m';
  a.ladderCursor = initialCursors(a.records);
  a.championPending = null;
  applyAudioSettings();
  game.events.emit(SETTINGS_CHANGED);
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
  // The touch pause button dispatches a synthetic Escape keydown on window (contract), so this
  // listener also serves touch.
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
    const action = menuAction(e.code || (e.key === 'Escape' ? 'Escape' : ''), e.repeat);
    if (action) handler(action, e);
  });
}

/** Current input modality (design 17.8). */
export function currentModality(): ModalityState {
  return modality.get();
}

export function isTouch(): boolean {
  return modality.get().modality === 'touch';
}

/**
 * Calls `fn` whenever the modality or the pad placement changes, for the lifetime of the scene.
 * Menu scenes restart on a modality change (copy, BACK items and tap layouts differ); their cursor
 * state lives in App, so a restart is invisible apart from the new layout.
 */
export function onModalityChange(scene: Phaser.Scene, fn: (s: ModalityState) => void): void {
  let last = modality.get();
  const off = modality.subscribe((s) => {
    if (s.modality === last.modality && s.padsOverCanvas === last.padsOverCanvas) return;
    last = s;
    if (scene.sys.isActive() || scene.sys.isPaused()) fn(s);
  });
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, off);
}

/** Restart a menu scene with the same data when the modality changes. */
export function restartOnModalityChange(scene: Phaser.Scene, data?: object): void {
  onModalityChange(scene, () => scene.scene.restart(data));
}

/** HAPTICS is listed only where navigator.vibrate exists (design 17.7). */
export function hapticsSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

/** Rival ids of an event's ladder in tier order. */
export function ladderIds(event: EventId): readonly OpponentId[] {
  return LADDERS[event].map((e) => e.id);
}

export function tierOf(event: EventId, id: OpponentId): number {
  return ladderEntry(event, id)?.tier ?? 1;
}

export function nextOpponent(event: EventId, id: OpponentId): OpponentId | null {
  return nextRival(event, id);
}

export function previousOpponent(event: EventId, id: OpponentId): OpponentId | null {
  const ids = ladderIds(event);
  const i = ids.indexOf(id);
  return i > 0 ? (ids[i - 1] ?? null) : null;
}

/**
 * Race music for a rival (design 7.1, 20.2): `race` (100 m), `hurdles` or `quarter` (400 m) with the
 * rival's tier. Audio itself switches tier 7 to `boss` in every event, so the event track is passed.
 */
export function raceMusic(event: EventId, id: OpponentId): { readonly id: MusicId; readonly tier: number } {
  const tier = tierOf(event, id);
  return { id: event === '110mh' ? 'hurdles' : event === '400m' ? 'quarter' : 'race', tier };
}
