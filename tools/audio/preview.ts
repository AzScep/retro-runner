/**
 * Dev-only listening page: `npx vite`, then open /tools/audio/preview.html.
 * Exercises the real engine (worker rendering, crossfades, ducking, crowd, volume) in a browser.
 */

import * as audio from '../../src/audio/index.ts';
import { audioState } from '../../src/audio/engine.ts';
import { SFX_IDS, type MusicId } from '../../src/audio/types.ts';

const $ = (id: string) => document.getElementById(id)!;

function button(parent: HTMLElement, label: string, onClick: () => void): void {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', () => {
    audio.unlockAudio();
    onClick();
  });
  parent.append(b);
}

const t0 = performance.now();
const preload = audio.preloadAudio().then(() => `preload ${(performance.now() - t0).toFixed(0)} ms`);

const tracks: [string, MusicId | null, number?][] = [
  ['title', 'title'],
  ['ladder', 'ladder'],
  ...[1, 2, 3, 4, 5, 6].map((t): [string, MusicId, number] => [`race ${t}`, 'race', t]),
  ['race 7 (boss)', 'race', 7],
  ['champion', 'champion'],
  ['gauntlet', 'gauntlet'],
  ['stop', null],
];
for (const [label, id, tier] of tracks) button($('music'), label, () => audio.playMusic(id, tier));
for (const id of SFX_IDS) button($('sfx'), id, () => audio.playSfx(id));

let ducked = false;
let muted = false;
let volume = 8;
let crowd = 0;
button($('mix'), 'duck', () => audio.duckMusic((ducked = !ducked)));
button($('mix'), 'mute', () => audio.setMuted((muted = !muted)));
button($('mix'), 'vol -', () => audio.setVolume((volume = Math.max(0, volume - 1))));
button($('mix'), 'vol +', () => audio.setVolume((volume = Math.min(10, volume + 1))));
button($('mix'), 'crowd 0 / .35 / 1', () => audio.setCrowd((crowd = crowd === 0 ? 0.35 : crowd < 1 ? 1 : 0)));
button($('mix'), 'run 10 steps/s', () => {
  let n = 0;
  const id = setInterval(() => {
    audio.playSfx(n % 2 ? 'step_r' : 'step_l');
    if (++n >= 30) clearInterval(id);
  }, 100);
});

let preloadText = 'preloading...';
void preload.then((t) => (preloadText = t));
setInterval(() => {
  $('state').textContent = `${preloadText}\n${JSON.stringify(audioState(), null, 1)}`;
}, 250);
