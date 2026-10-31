/**
 * Contract of the landing page sound (owner: J6). Sound is off until the visitor turns it on with
 * the toggle; until then playCue() does nothing. This stub keeps the page compiling until J6
 * replaces the bodies.
 */

export type LandingCue =
  'coin' | 'select' | 'badge' | 'countdown' | 'go' | 'step' | 'falseStart' | 'win' | 'lose';

/** Renders the sound on/off toggle into `host` (J5 puts the host in the HUD). */
export function mountSoundToggle(host: HTMLElement): void {
  void host;
}

export function playCue(cue: LandingCue): void {
  void cue;
}
