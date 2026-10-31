/**
 * Dev-only check of the sound toggle and every cue: `npm run dev`, then open
 * /src/landing/audio/preview.html. Hold the step button's key (or click fast) to hear the throttle.
 */
import '../styles/index.css';
import { mountSoundToggle, playCue, type LandingCue } from './index.ts';

const CUES: readonly LandingCue[] = [
  'coin',
  'select',
  'badge',
  'countdown',
  'go',
  'step',
  'falseStart',
  'win',
  'lose',
];

mountSoundToggle(document.getElementById('toggle') as HTMLElement);

const row = document.getElementById('cues') as HTMLElement;
for (const cue of CUES) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'rr-btn';
  b.textContent = cue;
  b.dataset.cue = cue;
  b.addEventListener('click', () => playCue(cue));
  row.append(b);
}
