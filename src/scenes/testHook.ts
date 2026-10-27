/**
 * window.__retroRunner for Playwright (research 2). Installed only when
 * import.meta.env.VITE_TEST_HOOKS === '1'; main.ts guards the import so normal builds drop it.
 */
import Phaser from 'phaser';
import { PALETTE } from '../art/index.ts';
import { toKmh, type RaceState, type RunnerState, type SaveData } from '../core/index.ts';
import { applyAudioSettings, getApp, hasApp, SceneKey, SETTINGS_CHANGED } from './app.ts';
import { audioPreloaded, bootError } from './BootScene.ts';
import type { HudScene, HudSnapshot } from './HudScene.ts';
import { OUTLINE_NAME } from '../ui/text.ts';

export interface RunnerSnapshot {
  readonly xM: number;
  readonly vMps: number;
  readonly kmh: number;
  readonly anim: string;
  readonly visible: boolean;
  readonly finishMs: number | null;
}

export interface TestState {
  readonly ready: boolean;
  readonly bootError: string | null;
  /** The background audio pre-render (started at boot, never awaited) has finished. */
  readonly audioPreloaded: boolean;
  /** Topmost running scene. */
  readonly scene: string | null;
  /** Every scene that is running or paused, bottom to top. */
  readonly scenes: readonly string[];
  readonly race: {
    readonly opponent: string;
    readonly seed: number;
    readonly phase: RaceState['phase'];
    readonly countdown: RaceState['countdown'];
    readonly raceMs: number;
    readonly falseStarts: number;
    readonly paused: boolean;
    readonly expectedSide: RaceState['expectedSide'];
    readonly idleMs: number;
    readonly player: RunnerSnapshot;
    readonly rival: RunnerSnapshot;
    readonly outcome: RaceState['outcome'];
  } | null;
  readonly hud: HudSnapshot | null;
  /** Text of every visible bitmap text in running scenes. */
  readonly texts: readonly string[];
  readonly records: SaveData | null;
  readonly persistent: boolean | null;
  readonly ladderCursor: string | null;
}

export interface TestHook {
  getState(): TestState;
  /** Force the seed of the next race. */
  seed(n: number): void;
  /** Reset records (Options -> reset) without the UI. */
  clearRecords(): void;
  /**
   * Snapshots the next rendered frame and returns every colour not in the master palette
   * (design 10, visuals) as "#rrggbb @x,y aA" (first pixel seen), plus the number of distinct colours.
   */
  paletteCheck(): Promise<{ readonly distinct: number; readonly offPalette: readonly string[] }>;
  /** The Phaser game, for screenshot tooling that stages scenes directly (results variants). */
  readonly game: Phaser.Game;
}

function runner(r: RunnerState): RunnerSnapshot {
  return {
    xM: r.xM,
    vMps: r.vMps,
    kmh: toKmh(r.vMps),
    anim: r.anim,
    visible: r.visible,
    finishMs: r.finishMs,
  };
}

function visibleTexts(scene: Phaser.Scene): string[] {
  const out: string[] = [];
  const walk = (objs: readonly Phaser.GameObjects.GameObject[]): void => {
    for (const o of objs) {
      if (o instanceof Phaser.GameObjects.BitmapText) {
        if (o.visible && o.text !== '' && o.name !== OUTLINE_NAME) out.push(o.text);
      } else if (o instanceof Phaser.GameObjects.Container) {
        if (o.visible) walk(o.list);
      }
    }
  };
  walk(scene.children.list);
  return out;
}

export function installTestHook(game: Phaser.Game): void {
  const hook: TestHook = {
    game,
    getState(): TestState {
      const mgr = game.scene;
      const live = mgr.getScenes(false).filter((s) => s.sys.isActive() || s.sys.isPaused());
      const running = live.filter((s) => s.sys.isActive());
      const app = hasApp() ? getApp() : null;
      const st = app?.race?.state ?? null;
      const hudScene = mgr.getScene(SceneKey.Hud) as HudScene | null;
      const hudLive = hudScene !== null && (hudScene.sys.isActive() || hudScene.sys.isPaused());
      return {
        ready: app !== null && running.some((s) => s.sys.settings.key !== SceneKey.Boot),
        bootError,
        audioPreloaded,
        scene: running.length > 0 ? (running[running.length - 1]?.sys.settings.key ?? null) : null,
        scenes: live.map((s) => s.sys.settings.key),
        race:
          st === null
            ? null
            : {
                opponent: st.opponent,
                seed: st.seed,
                phase: st.phase,
                countdown: st.countdown,
                raceMs: st.raceMs,
                falseStarts: st.falseStarts,
                paused: st.paused,
                expectedSide: st.expectedSide,
                idleMs: st.idleMs,
                player: runner(st.player),
                rival: runner(st.rival),
                outcome: st.outcome,
              },
        hud: hudLive ? hudScene.snapshot() : null,
        texts: live.flatMap((s) => visibleTexts(s)),
        records: app?.records.data ?? null,
        persistent: app?.records.persistent ?? null,
        ladderCursor: app?.ladderCursor ?? null,
      };
    },
    seed(n: number): void {
      getApp().pendingSeed = n >>> 0;
    },
    clearRecords(): void {
      const app = getApp();
      app.records.reset();
      app.ladderCursor = 'pip';
      app.championPending = false;
      applyAudioSettings();
      game.events.emit(SETTINGS_CHANGED);
    },
    paletteCheck() {
      const allowed = new Set(PALETTE.slice(1));
      return new Promise((resolve, reject) => {
        game.renderer.snapshot((snap) => {
          if (!(snap instanceof HTMLImageElement)) {
            reject(new Error('snapshot did not return an image'));
            return;
          }
          const c = document.createElement('canvas');
          c.width = snap.width;
          c.height = snap.height;
          const ctx = c.getContext('2d');
          if (!ctx) {
            reject(new Error('2D canvas unavailable'));
            return;
          }
          ctx.drawImage(snap, 0, 0);
          const d = ctx.getImageData(0, 0, c.width, c.height).data;
          const seen = new Map<number, string>();
          for (let i = 0; i < d.length; i += 4) {
            const rgb = ((d[i] ?? 0) << 16) | ((d[i + 1] ?? 0) << 8) | (d[i + 2] ?? 0);
            if (!seen.has(rgb)) {
              const p = i / 4;
              seen.set(rgb, `@${p % c.width},${Math.floor(p / c.width)} a${d[i + 3] ?? 0}`);
            }
          }
          const off = [...seen]
            .filter(([rgb]) => !allowed.has(rgb))
            .map(([rgb, where]) => `#${rgb.toString(16).padStart(6, '0')} ${where}`);
          resolve({ distinct: seen.size, offPalette: off.slice(0, 32) });
        });
      });
    },
  };
  (window as unknown as { __retroRunner: TestHook }).__retroRunner = hook;
}
