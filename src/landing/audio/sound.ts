/**
 * DOM-free decision logic of the landing page sound: when to load src/audio, what each cue plays,
 * the step throttle and the stored preference. index.ts wires it to the real backend, the page's
 * gestures and localStorage; the tests drive it with a fake backend of the same signatures.
 *
 * Sound starts off. Nothing is loaded or created until the visitor turns it on (or, when a stored
 * preference says on, until their first gesture), so a visitor who never asks for sound never
 * downloads the synth, never gets an AudioContext and never starts the music worker.
 */
import type * as AudioApi from '../../audio/index.ts';
import type { SfxId } from '../../audio/index.ts';

export type LandingCue =
  'coin' | 'select' | 'badge' | 'countdown' | 'go' | 'step' | 'falseStart' | 'win' | 'lose';

/** The part of src/audio/index.ts the page uses. */
export type AudioBackend = Pick<
  typeof AudioApi,
  'unlockAudio' | 'playSfx' | 'playMusic' | 'setMuted' | 'setVolume' | 'duckMusic'
>;

/** Where the on/off choice is remembered. Either call may throw (blocked storage). */
export interface PrefStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SoundDeps {
  /** Loads the audio backend (index.ts: a dynamic import of src/audio). */
  readonly load: () => Promise<AudioBackend>;
  readonly storage: PrefStorage | null;
  /** Milliseconds, monotonic (performance.now). */
  readonly now: () => number;
}

export interface Sound {
  readonly on: boolean;
  /** Turn sound on or off. Call from a user gesture (the toggle or the M key). */
  setOn(on: boolean): void;
  /** Any click, tap or key press on the page: the moment a browser lets audio start or resume. */
  gesture(): void;
  /** Start downloading the backend without creating anything (pointerdown on the toggle). */
  prefetch(): void;
  play(cue: LandingCue): void;
  /** Called after every change of `on`. Returns the unsubscribe function. */
  subscribe(listener: (on: boolean) => void): () => void;
}

export const PREF_KEY = 'retroRunner.welcome.sound';

/**
 * The game's own SFX for each cue (src/audio/sfx.ts, design 7 and 20.1). The game has no coin
 * sound; `split`, a square blip jumping a fourth up, is the classic coin pickup shape. `go` layers
 * the pistol over the horn like the race start (RaceScene).
 */
export const CUE_SFX: Readonly<Record<Exclude<LandingCue, 'step'>, readonly SfxId[]>> = {
  coin: ['split'],
  select: ['menu_select'],
  badge: ['unlock'],
  countdown: ['beep_count'],
  go: ['beep_go', 'pistol'],
  falseStart: ['false_start'],
  win: ['win_jingle'],
  lose: ['lose_jingle'],
};

/** At most one step per this many ms: mashing at any rate stays a light patter of a few voices. */
export const STEP_GAP_MS = 70;
/** Steps sit under everything else (the game plays them at full volume over crowd and music). */
export const STEP_VOLUME = 0.35;
/** Master volume 0-10 (the game's default is 8): the page is quieter than the game. */
export const LANDING_VOLUME = 6;

export function createSound(deps: SoundDeps): Sound {
  let on = readPref(deps.storage);
  let backend: AudioBackend | null = null;
  let loading: Promise<void> | null = null;
  let lastStep = -Infinity;
  let nextStepRight = false;
  const listeners = new Set<(on: boolean) => void>();

  function load(): void {
    loading ??= deps.load().then(
      (b) => {
        backend = b;
        b.setVolume(LANDING_VOLUME);
        // The music bus duck is the only music-only level in the public API: the title theme
        // stays at 40% under the cues for the whole visit.
        b.duckMusic(true);
        apply();
      },
      () => {
        loading = null; // a failed download (offline) is retried on the next gesture
      },
    );
  }

  /** Push `on` into the backend. unlockAudio() first, so it runs inside the gesture when it can. */
  function apply(): void {
    if (!backend) return;
    if (on) {
      backend.unlockAudio();
      backend.setMuted(false);
      backend.playMusic('title');
    } else {
      backend.playMusic(null);
      backend.setMuted(true);
    }
  }

  return {
    get on() {
      return on;
    },
    setOn(next) {
      if (next === on) return;
      on = next;
      writePref(deps.storage, on);
      if (on) load();
      apply();
      for (const l of listeners) l(on);
    },
    gesture() {
      if (!on) return;
      // Resumes a context the browser created suspended or suspended itself (iOS interruptions).
      if (backend) backend.unlockAudio();
      else load();
    },
    prefetch() {
      // Only the download: the backend creates nothing at import time (src/audio/engine.ts).
      if (!on) void deps.load().catch(() => {});
    },
    play(cue) {
      if (!on || !backend) return;
      if (cue === 'step') {
        const t = deps.now();
        if (t - lastStep < STEP_GAP_MS) return;
        lastStep = t;
        backend.playSfx(nextStepRight ? 'step_r' : 'step_l', { volume: STEP_VOLUME });
        nextStepRight = !nextStepRight;
        return;
      }
      for (const id of CUE_SFX[cue]) backend.playSfx(id);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function readPref(storage: PrefStorage | null): boolean {
  try {
    return storage?.getItem(PREF_KEY) === 'on';
  } catch {
    return false;
  }
}

function writePref(storage: PrefStorage | null, on: boolean): void {
  try {
    storage?.setItem(PREF_KEY, on ? 'on' : 'off');
  } catch {
    // No storage (private mode, blocked site data): the choice lasts for this visit only.
  }
}
