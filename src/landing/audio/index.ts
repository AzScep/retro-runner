/**
 * Landing page sound (owner: J6): an opt-in toggle, the game's SFX for page cues and the title
 * theme, quiet, in a loop. Off by default; while off, playCue() does nothing and no audio code is
 * loaded. src/audio (engine-free Web Audio) arrives through a dynamic import on first enable, so
 * it is its own chunk and never part of the welcome page's initial load.
 *
 * Hidden tabs need nothing here: src/audio suspends its AudioContext on visibilitychange, which
 * pauses the music where it is, and resumes it when the tab is shown again.
 */
import { createSound, type LandingCue, type PrefStorage, type Sound } from './sound.ts';
import { mountToggleButton, togglesOnKey } from './toggle.ts';

export type { LandingCue } from './sound.ts';

let sound: Sound | null = null;

function getSound(): Sound {
  sound ??= createSound({
    load: () => import('../../audio/index.ts'),
    storage: pageStorage(),
    now: () => performance.now(),
  });
  return sound;
}

function pageStorage(): PrefStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

let listening = false;

/** Page-wide listeners, once: gestures (to start or resume audio) and the M shortcut. */
function listen(s: Sound): void {
  if (listening) return;
  listening = true;
  const gesture = () => s.gesture();
  window.addEventListener('pointerdown', gesture, { capture: true, passive: true });
  window.addEventListener('keydown', gesture, { capture: true, passive: true });
  // Bubble phase on window, so a dash handler on its host or the document can preventDefault first.
  window.addEventListener('keydown', (e) => {
    if (togglesOnKey(e)) s.setOn(!s.on);
  });
}

/** Renders the sound on/off toggle into `host` (J5 puts the host in the HUD). */
export function mountSoundToggle(host: HTMLElement): void {
  const s = getSound();
  listen(s);
  mountToggleButton(host, s);
}

export function playCue(cue: LandingCue): void {
  sound?.play(cue);
}
