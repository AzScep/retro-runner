/**
 * Throwaway prototype (question 2): play a 100 m with today's fumble rule or a deterministic trip.
 *   npx vite --port 5191   then open /tools/prototype/trip.html
 * Left/Right (or A/D) to run, Space or Enter to restart. A dim ghost runs the same key presses
 * under rule A, so the gap to it is exactly what the trip cost.
 */
import { toRGBA, type IndexMap } from '../../src/art/bake/index.ts';
import { buildCharacter } from '../../src/art/chars/index.ts';
import { DEFAULT_TRIP, TripRace, type Rule, type TripParams } from './tripModel.ts';
import type { Side } from '../../src/core/index.ts';

const W = 320;
const PX_PER_M = 24;
const FEET_Y = 150;
const GHOST_FEET_Y = 132;
const COUNTDOWN_MS = 1500;

const canvas = document.getElementById('view') as HTMLCanvasElement;
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
ctx.imageSmoothingEnabled = false;
const $ = (id: string) => document.getElementById(id) as HTMLInputElement;

function sprite(m: IndexMap, ghost = false): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = m.w;
  c.height = m.h;
  const x = c.getContext('2d') as CanvasRenderingContext2D;
  const img = x.createImageData(m.w, m.h);
  const rgba = toRGBA(m);
  if (ghost) for (let i = 3; i < rgba.length; i += 4) rgba[i] = rgba[i] ? 90 : 0;
  img.data.set(rgba);
  x.putImageData(img, 0, 0);
  return c;
}

const rio = new Map<string, HTMLCanvasElement>();
const ghostFrames = new Map<string, HTMLCanvasElement>();
for (const f of buildCharacter('rio').frames) {
  rio.set(f.name, sprite(f.map));
  ghostFrames.set(f.name, sprite(f.map, true));
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function params(): TripParams {
  return {
    rule: ($('rule') as unknown as HTMLSelectElement).value as Rule,
    windowS: Number($('w').value),
    lieS: Number($('l').value),
    bleedS: Number($('b').value),
    speedLoss: Number($('loss').value),
  };
}

function syncLabels(): void {
  $('wv').value = `${Number($('w').value).toFixed(2)} s`;
  $('lv').value = `${Number($('l').value).toFixed(2)} s`;
  $('bv').value = `${Number($('b').value).toFixed(2)} s`;
  $('lossv').value = `${Math.round(Number($('loss').value) * 100)} %`;
}
for (const id of ['w', 'l', 'b', 'loss']) $(id).addEventListener('input', syncLabels);
$('w').value = String(DEFAULT_TRIP.windowS);
$('l').value = String(DEFAULT_TRIP.lieS);
$('b').value = String(DEFAULT_TRIP.bleedS);
$('loss').value = String(DEFAULT_TRIP.speedLoss);
syncLabels();

// ---------------------------------------------------------------------------
// Race loop
// ---------------------------------------------------------------------------

let race = new TripRace(params());
let ghost = new TripRace({ ...params(), rule: 'A' });
let goT = performance.now() + COUNTDOWN_MS;
let phase = 0;
let ghostPhase = 0;
let lastT = performance.now();
let flash = '';
let flashUntil = 0;
let logged = false;
const queue: { kind: 'down' | 'up'; side: Side; t: number; repeat: boolean }[] = [];

function restart(): void {
  race = new TripRace(params());
  ghost = new TripRace({ ...params(), rule: 'A' });
  goT = performance.now() + COUNTDOWN_MS;
  queue.length = 0;
  logged = false;
  flash = '';
  (document.activeElement as HTMLElement | null)?.blur();
}
$('restart').addEventListener('click', restart);
($('rule') as unknown as HTMLSelectElement).addEventListener('change', restart);

const KEYS: Record<string, Side> = { ArrowLeft: 'L', KeyA: 'L', ArrowRight: 'R', KeyD: 'R' };
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.code === 'Enter') {
    e.preventDefault();
    restart();
    return;
  }
  const side = KEYS[e.code];
  if (!side) return;
  e.preventDefault();
  queue.push({ kind: 'down', side, t: e.timeStamp, repeat: e.repeat });
});
window.addEventListener('keyup', (e) => {
  const side = KEYS[e.code];
  if (side) queue.push({ kind: 'up', side, t: e.timeStamp, repeat: false });
});

function feed(now: number): void {
  for (const q of queue) {
    const ms = q.t - goT;
    if (ms < 0) continue; // before GO: ignored in this prototype (no false starts)
    for (const r of [race, ghost]) {
      r.advanceTo(ms);
      if (q.kind === 'up') r.release(q.side);
    }
    if (q.kind === 'down') {
      const res = race.press(q.side, ms, q.repeat);
      ghost.press(q.side, ms, q.repeat);
      if (res === 'fumble' || res === 'trip') {
        flash = res === 'trip' ? 'TRIP!' : 'FUMBLE';
        flashUntil = now + (res === 'trip' ? 900 : 250);
      }
    }
  }
  queue.length = 0;
  const ms = now - goT;
  if (ms > 0) {
    race.advanceTo(ms);
    ghost.advanceTo(ms);
  }
}

function drawRunner(
  r: TripRace,
  frames: Map<string, HTMLCanvasElement>,
  feetY: number,
  x: number,
  ph: number,
) {
  const pose = r.pose();
  let f = 'ready1';
  let rot = 0;
  if (pose === 'fall') f = `stumble${Math.min(2, Math.floor((r.ms % 250) / 84))}`;
  else if (pose === 'down') {
    f = 'stumble2';
    rot = Math.PI / 2;
  } else if (r.body.v >= 0.3) f = `run${Math.floor(ph) % 8}`;
  const img = frames.get(f) ?? (frames.get('ready1') as HTMLCanvasElement);
  ctx.save();
  ctx.translate(Math.round(x), feetY + 1);
  if (rot) {
    ctx.rotate(rot);
    ctx.drawImage(img, -47, -24 - 6);
  } else {
    ctx.drawImage(img, -24, -47);
  }
  ctx.restore();
}

function frame(now: number): void {
  const dt = Math.min(100, now - lastT);
  lastT = now;
  feed(now);
  const xM = race.body.x;
  const scroll = Math.round(96 + xM * PX_PER_M) - 96;
  // Sky, stands, track.
  ctx.fillStyle = '#4b8df0';
  ctx.fillRect(0, 0, W, 60);
  ctx.fillStyle = '#2e2a45';
  ctx.fillRect(0, 60, W, 44);
  for (let i = 0; i < 40; i++) {
    ctx.fillStyle = ['#b02a32', '#ffd23f', '#f4f2ff', '#2456b8'][i % 4] as string;
    ctx.fillRect(((i * 37 - Math.round(scroll * 0.3)) % 360) + (i % 2 ? 4 : 0) - 20, 66 + (i % 5) * 7, 3, 3);
  }
  ctx.fillStyle = '#8f3f2a';
  ctx.fillRect(0, 104, W, 56);
  ctx.fillStyle = '#f4f2ff';
  for (const y of [108, 136, 154]) ctx.fillRect(0, y, W, 1);
  ctx.fillStyle = '#2e7a3a';
  ctx.fillRect(0, 160, W, 20);
  // Start, distance marks every 10 m, finish.
  for (let m = 0; m <= 100; m += 10) {
    const x = 96 + m * PX_PER_M - scroll;
    if (x < -20 || x > W + 20) continue;
    ctx.fillStyle = m === 100 ? '#0b0b14' : '#f4f2ff';
    ctx.fillRect(x, 108, m === 100 ? 4 : 1, 47);
    ctx.fillStyle = '#f4f2ff';
    ctx.font = '8px monospace';
    ctx.fillText(`${m}`, x - 6, 101);
  }
  // Runners: the ghost (rule A, same presses) in the far lane, the player in front.
  const fps = (v: number) => Math.min(25, Math.max(6, 2 * v));
  phase = (phase + (dt / 1000) * fps(race.body.v)) % 8;
  ghostPhase = (ghostPhase + (dt / 1000) * fps(ghost.body.v)) % 8;
  drawRunner(ghost, ghostFrames, GHOST_FEET_Y, 96 + ghost.body.x * PX_PER_M - scroll, ghostPhase);
  drawRunner(race, rio, FEET_Y, 96 + xM * PX_PER_M - scroll, phase);

  // HUD.
  const ms = Math.max(0, Math.min(now - goT, race.body.finishMs ?? Infinity));
  ctx.fillStyle = '#f4f2ff';
  ctx.font = '16px monospace';
  ctx.fillText((ms / 1000).toFixed(2), 132, 18);
  ctx.font = '8px monospace';
  ctx.fillText(`${(race.body.v * 3.6).toFixed(0)} KM/H`, 6, 172);
  ctx.fillText(`TRIPS ${race.trips}  FUMBLES ${race.fumbles}`, 200, 172);
  const gap = ghost.body.x - race.body.x;
  if (gap > 0.05) ctx.fillText(`GHOST (RULE A) +${gap.toFixed(1)} M`, 6, 30);
  if (now < goT) {
    ctx.font = '24px monospace';
    ctx.fillText(String(Math.ceil((goT - now) / 500)), 152, 80);
  } else if (now - goT < 500) {
    ctx.font = '24px monospace';
    ctx.fillText('GO!', 140, 80);
  }
  if (now < flashUntil) {
    ctx.fillStyle = flash === 'TRIP!' ? '#e8503f' : '#ffd23f';
    ctx.font = '12px monospace';
    ctx.fillText(flash, 140, 60);
  }
  if (race.finished && ghost.finished && !logged) {
    logged = true;
    const p = race.p;
    const li = document.createElement('li');
    const t = (race.body.finishMs as number) / 1000;
    const g = (ghost.body.finishMs as number) / 1000;
    li.textContent =
      `${t.toFixed(2)} s (rule A on the same presses: ${g.toFixed(2)} s, lost ${(t - g).toFixed(2)} s) | ` +
      `rule ${p.rule} W ${p.windowS} L ${p.lieS} bleed ${p.bleedS} loss ${p.speedLoss} | ` +
      `trips ${race.trips} fumbles ${race.fumbles} steps ${race.steps}`;
    document.getElementById('log')?.prepend(li);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
