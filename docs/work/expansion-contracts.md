# Expansion v2 - cross-team contracts

Temporary work doc for the v2 expansion (events, hurdles, 400 m, touch).
Spec: `docs/design.md` sections 12-22 (authoritative) and `docs/research-mobile.md`.
Delete this file once v2 ships; the code and each layer's `index.ts` then carry the contract.

Each layer exposes its API only through its `index.ts`.
The signatures below are binding: owners implement them, consumers code against them.
Owners may ADD exports; a change to anything listed here needs the orchestrator.
Until an owner lands a piece, consumers may see type errors for it; that is expected mid-flight, not a reason to stub it in someone else's folder.

## Ownership

| Agent | Owns (may edit) |
|---|---|
| MECHANICS | `src/core/**` |
| ART | `src/art/**`, `tools/art/**`, `public/icons/**`, `scripts/icons.ts` |
| AUDIO | `src/audio/**`, `tools/audio/**` |
| UI | `src/scenes/**`, `src/ui/**`, `e2e/game.spec.ts`, `e2e/helpers.ts`, `e2e/events.spec.ts` |
| TOUCH | `src/touch/**`, `src/main.ts`, `index.html`, `vite.config.ts` (PWA: `vite-plugin-pwa@2.0.0` is installed), `public/manifest.webmanifest`, `vercel.json`, `e2e/touch.spec.ts`, `e2e/touchHelpers.ts`, `playwright.config.ts` |
| Orchestrator | `package.json`, lockfile, `eslint.config.js`, tsconfig, docs |

Nobody runs `npm install`.
If you need a dependency or a config change, stop and ask the orchestrator.

Import boundaries (ESLint enforces): `core` imports nothing else; `art` and `audio` import only `core`; `ui`/`scenes` import `core`, `art`, `audio`; `touch` imports `core`, `art` and `src/ui/tapTargets.ts` only; only `src/main.ts` imports `touch`.

## Core (MECHANICS)

### Events and ladders

```ts
export type EventId = '100m' | '110mh' | '400m';
export const EVENT_IDS: readonly EventId[]; // ['100m', '110mh', '400m']

export interface EventInfo {
  readonly id: EventId;
  readonly name: string;      // '110 METRES HURDLES'
  readonly short: string;     // 'HURDLES'
  readonly distanceM: number; // 100 | 110 | 400
  readonly dnfMs: number;     // 30000 | 40000 | 90000
}
export const EVENTS: Readonly<Record<EventId, EventInfo>>;

export type OpponentId = 'pip' | 'jess' | 'marco' | 'kofi' | 'valentina' | 'unit7' | 'zyx' | 'sol';
export type CharacterId = OpponentId | 'rio';

/** Character identity only; per-event data lives in LADDERS. (v1 targetMs/flavour/tier move out.) */
export interface OpponentInfo { readonly id: OpponentId; readonly name: string; readonly who: string }
export const OPPONENTS: Readonly<Record<OpponentId, OpponentInfo>>;

export interface LadderEntry {
  readonly event: EventId;
  readonly id: OpponentId;
  readonly tier: number;      // 1-7
  readonly targetMs: number;
  readonly flavour: string;
}
/** 7 entries per event in tier order (design 15.6). */
export const LADDERS: Readonly<Record<EventId, readonly LadderEntry[]>>;
export function ladderEntry(event: EventId, id: OpponentId): LadderEntry | null;
/** Next rival on that event's ladder, or null after tier 7. */
export function nextRival(event: EventId, id: OpponentId): OpponentId | null;

/** Hurdle positions in metres (design 13.1); empty for other events. */
export function hurdlePositions(event: EventId): readonly number[];
```

`OPPONENT_IDS` is removed (use `LADDERS[event]`).
`WORLD.RACE_DISTANCE_M` is removed (use `EVENTS[event].distanceM`); the rest of `WORLD` stays.
`TUNING` gains the section 11 v2 constants.

### Input

```ts
export type Side = 'L' | 'R';
export interface RunKeyEvent { readonly kind: 'down' | 'up'; readonly side: Side; readonly t: number; readonly repeat: boolean }
export interface JumpEvent { readonly kind: 'down' | 'up'; readonly action: 'jump'; readonly t: number; readonly repeat: boolean }
export type RaceInput = RunKeyEvent | JumpEvent;
export function isJump(e: RaceInput): e is JumpEvent;

/** Keyboard: ArrowLeft/KeyA -> L, ArrowRight/KeyD -> R, ArrowUp/KeyW -> jump. Same rules as v1. */
export function attachKeyboard(target: Window, onEvent: (e: RaceInput) => void): () => void;

/** App-wide pub/sub so touch and keyboard feed the race without importing scenes. */
export interface InputHub {
  emit(e: RaceInput): void;
  subscribe(fn: (e: RaceInput) => void): () => void;
}
export function createInputHub(): InputHub;
export const raceInput: InputHub; // the app instance

/** Per-frame race broadcast for non-scene consumers (touch pads, haptics). */
export interface RaceFeed {
  publish(state: RaceState | null, events: readonly RaceEvent[]): void; // null = no race on screen
  subscribe(fn: (state: RaceState | null, events: readonly RaceEvent[]) => void): () => void;
}
export const raceFeed: RaceFeed;

/** Input modality (design 17.8) and touch layout facts the HUD needs. */
export type Modality = 'keyboard' | 'touch';
export interface ModalityState { readonly modality: Modality; readonly padsOverCanvas: boolean }
export interface ModalityStore {
  get(): ModalityState;
  set(patch: Partial<ModalityState>): void;
  subscribe(fn: (s: ModalityState) => void): () => void;
}
export const modality: ModalityStore; // default { modality: 'keyboard', padsOverCanvas: false }
```

Held-side rule across sources: a side is held while any key or finger for it is down.
Each source (keyboard adapter, touch adapter) emits `down` only for the first press on a side and `up` only when its last press on that side lifts; the race keeps a per-side count across sources so a side counts as held while either source holds it.

### Race

```ts
export interface RaceOptions { readonly event: EventId; readonly opponent: OpponentId; readonly seed: number; readonly startT: number }

export type RunnerAnim = 'idle' | 'walk' | 'ready1' | 'ready2' | 'run' | 'tired' | 'hurdle' | 'lean' | 'celebrate' | 'lose' | 'stumble';
export type RunnerEffect = 'none' | 'wave' | 'overclock' | 'overheat' | 'warpOut' | 'warpIn' | 'sweat' | 'watch';

export interface RunnerState {
  // v1 fields unchanged: xM, vMps, anim, runFps, effect, visible, finishMs
  /** Feet height above the lane in metres (0 on the ground); views raise the sprite round(airM * 24) px. */
  readonly airM: number;
  /** Arc phase 0-1 while airborne (hurdle frame = floor(4 * s)), else null. */
  readonly airPhase: number | null;
  /** Per hurdle (10 in 110mh, [] otherwise): true once knocked. */
  readonly hurdlesKnocked: readonly boolean[];
  /** 0-1 stamina (400 m player only), else null. */
  readonly stamina: number | null;
}

export interface RaceState {
  // v1 fields unchanged (opponent, seed, phase, countdown, raceMs, timerMs, getSet, falseStarts, paused, expectedSide, idleMs, player, rival, outcome)
  readonly event: EventId;
  /** Seconds until the player reaches the next hurdle at current speed (null: no hurdle ahead or v < 1 m/s). */
  readonly nextHurdleS: number | null;
  /** Index (0-9) of the player's next hurdle, null after H10 or outside hurdles. */
  readonly nextHurdleIndex: number | null;
  /** Player split times reached so far (400 m: up to 3 ms values at 100/200/300 m). */
  readonly splits: readonly number[];
  /** 400 m: true while net draining (for the stamina arrow). */
  readonly staminaDraining: boolean;
}

export type Lane = 'player' | 'rival';
export type RaceEvent =
  | /* all v1 events unchanged */ ...
  | { readonly type: 'jump'; readonly lane: Lane }
  | { readonly type: 'land'; readonly lane: Lane }
  | { readonly type: 'hurdleClear'; readonly lane: Lane; readonly index: number }
  | { readonly type: 'hurdleClip'; readonly lane: Lane; readonly index: number }
  | { readonly type: 'hurdleHit'; readonly lane: Lane; readonly index: number }
  | { readonly type: 'split'; readonly index: number; readonly ms: number } // player, 400 m
  | { readonly type: 'bell' }            // player passes 300 m
  | { readonly type: 'staminaLow' }      // every 0.6 s while S < S_FATIGUE
  | { readonly type: 'staminaEmpty' }    // S reaches 0, max once per 3 s
  | { readonly type: 'eventUnlocked'; readonly event: EventId }; // never from Race; reserved for records
// The v1 'quirk' name union gains 'watch' and 'sweat'.

export interface RaceOutcome {
  // v1 fields unchanged
  readonly event: EventId;
  /** Hurdles knocked by the player (110mh), else null. */
  readonly hit: number | null;
  /** Player splits (400 m), else []. */
  readonly splits: readonly number[];
}
```

`Race` keeps its methods; `input(e: RaceInput)` accepts jumps.

### Formatting

`formatTime(ms)` returns `M:SS.hh` at 60 s or more (design 14.4), `SS.hh` below, same ceil rule.
`formatLadderTotal(ms)` (new, core) returns `M:SS.hh` always (design 16.5).

### Records v2

```ts
export interface Settings { volume; muted; reducedFlashing; screenShake; crt; readonly haptics: boolean }
export interface BestTime { readonly ms: number; readonly at: string; readonly hit?: number; readonly splits?: readonly number[] }
export interface HistoryEntry { /* v1 fields */ readonly hit?: number; readonly splits?: readonly number[] }
export interface EventRecords {
  readonly unlockedTier: number; readonly beaten: readonly OpponentId[]; readonly champion: boolean;
  readonly best: Readonly<Partial<Record<OpponentId, BestTime>>>; readonly history: readonly HistoryEntry[];
}
export interface SaveData {
  readonly version: 2; readonly lastEvent: EventId; readonly seenEvents: readonly EventId[];
  readonly hints: { readonly addToHomeScreen: boolean };
  readonly settings: Settings; readonly events: Readonly<Record<EventId, EventRecords>>;
}
export interface RecordOutcome {
  readonly newPb: boolean; readonly previousPbMs: number | null;
  readonly unlocked: OpponentId | null;   // next rival in the same event
  readonly unlockedEvent: EventId | null; // design 12.2
  readonly becameChampion: boolean;       // first tier 7 win in this event
}
export const SAVE_KEY_V1 = 'retroRunner.save.v1';
export const SAVE_KEY = 'retroRunner.save.v2';
export const CORRUPT_KEY = 'retroRunner.save.corrupt';

export class RecordsStore {
  static load(storage: KeyValueStorage | null): RecordsStore; // v2 load + v1 migration (design 16.4)
  get data(): SaveData;
  get persistent(): boolean;
  isEventUnlocked(event: EventId): boolean;
  isUnlocked(event: EventId, id: OpponentId): boolean;
  isBeaten(event: EventId, id: OpponentId): boolean;
  best(event: EventId, id: OpponentId): BestTime | null;
  bestMs(event: EventId, id: OpponentId): number | null;
  recent(event: EventId, id: OpponentId, n: number): readonly HistoryEntry[];
  ladderTotalMs(event: EventId): number | null;
  record(outcome: RaceOutcome, at: Date): RecordOutcome; // event from outcome.event
  markEventSeen(event: EventId): void;  // also sets lastEvent
  setHint(name: 'addToHomeScreen', value: boolean): void;
  updateSettings(patch: Partial<Settings>): void;
  reset(): void; // design 16.4 rule 5
}
```

## Art (ART)

```ts
// Character art now includes 'sol' (CharacterId) and anims `${id}.hurdle` (4 frames, frame chosen by
// airPhase) and `rio.tired` (8 frames).
export class RaceView {
  constructor(scene: Phaser.Scene, event: EventId, opponent: OpponentId, opts: RaceViewOptions);
  // update(state, events), rivalScreenX(), destroy() unchanged. Draws hurdles per lane, knock anims,
  // clip burst, raised sprites with ground shadows, 50 m and split boards, lap-bell official, sweat drops.
}
export type IconId = /* v1 ids */ | 'keyUp' | 'crown' | 'newBadge' | 'pause' | 'rotatePhone'
  | 'staminaArrowUp' | 'staminaArrowDown' | 'lapOval' | 'hurdleTick';
export function keyIconKey(key: 'L' | 'R' | 'U', state: KeyState): string; // 'U' = up/jump key
export function eventIconKey(event: EventId, size: 16 | 32, locked?: boolean): string;
/** Pixel-perfect PNG data URL of a touch control sprite at an integer scale, for the DOM overlay. */
export type TouchArtId = 'padL' | 'padR' | 'padJump' | 'pause' | 'rotatePhone';
export type TouchArtState = 'idle' | 'expected' | 'ready' | 'pressed' | 'blocked' | 'fumble';
export function touchArtUrl(id: TouchArtId, state: TouchArtState, scale: number): string;
```

Stadium per tier is unchanged (`createStadium(scene, tier)`); the race uses the rival's tier in that event.

## Audio (AUDIO)

```ts
export type SfxId = /* v1 ids */ | 'jump' | 'land' | 'hurdle_clip' | 'hurdle_hit' | 'split' | 'bell' | 'stamina_low' | 'stamina_empty';
export type MusicId = /* v1 ids */ | 'hurdles' | 'quarter';
/** 400 m: crossfade the quarter track to its "final 100" render (design 20.2). */
export function setQuarterFinal(final: boolean): void;
/** Rival takeoffs play `jump` at half volume. */
export function playSfx(id: SfxId, opts?: { readonly volume?: number }): void;
```

## UI (UI)

```ts
// src/ui/tapTargets.ts - the only UI file touch imports.
export interface TapRect { readonly x: number; readonly y: number; readonly w: number; readonly h: number } // game px
/** Scenes register tap targets; removed automatically on scene shutdown. */
export function registerTapTarget(scene: Phaser.Scene, rect: TapRect, onTap: () => void): () => void;
/** Touch calls this with a tap position in game px (after pointerup). Returns true if a target took it. */
export function dispatchTap(x: number, y: number): boolean;
```

UI reads `modality` from core for copy (`TAP TO START`, `TAP JUMP`), `BACK` items and HUD positions (`padsOverCanvas`).
`RaceScene` feeds `raceInput` into `Race.input` and calls `raceFeed.publish(state, events)` every frame (and `publish(null, [])` on shutdown).

## Touch (TOUCH)

```ts
// src/touch/index.ts - imported only by src/main.ts.
export interface TouchHandle { relayout(canvasRect: DOMRect, gamePx: number): void; detach(): void }
export function installTouch(opts: { readonly canvas: HTMLCanvasElement; readonly unlockAudio: () => void; readonly getSettings: () => Settings; readonly setHint: (name: 'addToHomeScreen', v: boolean) => void; readonly hintSeen: () => boolean }): TouchHandle;
```

Touch emits run and jump input through `raceInput`, reads `raceFeed` for pad states and haptics, sets `modality`, and converts canvas taps with `dispatchTap`.
The pause button dispatches a synthetic Escape keydown on `window`.
