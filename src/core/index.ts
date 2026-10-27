/**
 * Public API of the game core (owner: MECHANICS).
 *
 * Pure TypeScript: no Phaser, no DOM, except `attachKeyboard` (input/adapter.ts) and
 * `browserStorage` (platform/storage.ts). Other layers import only from this file. Signatures here
 * are the cross-team contract (docs/work/expansion-contracts.md, section "Core").
 *
 * Spec: docs/design.md sections 1-4, 11 (v1) and 12-16 (v2). Timing approach: docs/research.md 7.
 */

// ---------------------------------------------------------------------------
// Events and ladders (design 12, 13.1, 15)
// ---------------------------------------------------------------------------

export type EventId = '100m' | '110mh' | '400m';

export interface EventInfo {
  readonly id: EventId;
  /** '110 METRES HURDLES' */
  readonly name: string;
  /** 'HURDLES' (tabs, 8 px) */
  readonly short: string;
  /** 100 | 110 | 400 */
  readonly distanceM: number;
  /** 30000 | 40000 | 90000 */
  readonly dnfMs: number;
}

export type OpponentId = 'pip' | 'jess' | 'marco' | 'kofi' | 'valentina' | 'unit7' | 'zyx' | 'sol';
export type CharacterId = OpponentId | 'rio';

/** Character identity only; per-event data lives in LADDERS. */
export interface OpponentInfo {
  readonly id: OpponentId;
  /** Display name, e.g. "UNIT-7". */
  readonly name: string;
  /** Who they are, e.g. "Primary school student". */
  readonly who: string;
}

export interface LadderEntry {
  readonly event: EventId;
  readonly id: OpponentId;
  /** 1-7 */
  readonly tier: number;
  readonly targetMs: number;
  /** One-line flavour text for the ladder card. */
  readonly flavour: string;
}

export { EVENT_IDS, EVENTS, EVENT_COURSE, EVENT_LOCK_TEXT, hurdlePositions } from './events.ts';
export type { EventCourse } from './events.ts';

/**
 * LADDERS: 7 entries per event in tier order (design 15.6).
 * ladderEntry(event, id): that rival's entry, or null if not on the event's ladder.
 * nextRival(event, id): next rival on that ladder, or null after tier 7.
 */
export { OPPONENTS, LADDERS, ladderEntry, nextRival, PLAYER, WORLD, TUNING } from './roster.ts';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type Side = 'L' | 'R';

/** A raw run input. `t` is a DOMHighResTimeStamp on the performance.now() origin. */
export interface RunKeyEvent {
  readonly kind: 'down' | 'up';
  readonly side: Side;
  readonly t: number;
  readonly repeat: boolean;
}

/** A raw jump input (ArrowUp/KeyW or the JUMP touch control). Same time base as RunKeyEvent. */
export interface JumpEvent {
  readonly kind: 'down' | 'up';
  readonly action: 'jump';
  readonly t: number;
  readonly repeat: boolean;
}

export type RaceInput = RunKeyEvent | JumpEvent;

/**
 * Held rule across sources: each source (keyboard adapter, touch adapter) emits `down` only for its
 * first press on a side (or on jump) and `up` only when its last press there lifts. The race keeps
 * a per-side count across sources, so a side counts as held while either source holds it.
 * Repeat downs (`repeat: true`) are ignored by the race and never change held counts.
 */
export { isJump, createInputHub, createRaceFeed, createModalityStore } from './bus/bus.ts';

/**
 * Keyboard: ArrowLeft/KeyA -> L, ArrowRight/KeyD -> R, ArrowUp/KeyW -> jump (by event.code), on
 * `target` in the capture phase, with preventDefault. Emits down for the first key of a side,
 * up when the last key of that side lifts, repeat downs for the key that repeats; synthesises ups
 * for held sides on window blur. Returns a detach function.
 */
export { attachKeyboard } from './input/adapter.ts';

/** App-wide pub/sub so touch and keyboard feed the race without importing scenes. */
export interface InputHub {
  emit(e: RaceInput): void;
  subscribe(fn: (e: RaceInput) => void): () => void;
}

/** Per-frame race broadcast for non-scene consumers (touch pads, haptics). */
export interface RaceFeed {
  /** null = no race on screen. */
  publish(state: RaceState | null, events: readonly RaceEvent[]): void;
  subscribe(fn: (state: RaceState | null, events: readonly RaceEvent[]) => void): () => void;
}

/** Input modality (design 17.8) and touch layout facts the HUD needs. */
export type Modality = 'keyboard' | 'touch';
export interface ModalityState {
  readonly modality: Modality;
  readonly padsOverCanvas: boolean;
}
export interface ModalityStore {
  get(): ModalityState;
  /** Notifies subscribers only when something changed. */
  set(patch: Partial<ModalityState>): void;
  subscribe(fn: (s: ModalityState) => void): () => void;
}

/**
 * raceInput: the app instance; attach the keyboard once with `attachKeyboard(window, raceInput.emit)`
 * and have RaceScene `raceInput.subscribe((e) => race.input(e))`.
 * raceFeed: RaceScene publishes `(race.state, events)` every frame and `(null, [])` on shutdown.
 * modality: default { modality: 'keyboard', padsOverCanvas: false }.
 */
export { raceInput, raceFeed, modality } from './bus/bus.ts';

// ---------------------------------------------------------------------------
// Race simulation
// ---------------------------------------------------------------------------

/**
 * intro: runners walk to the blocks (1.5 s) then crouch.
 * countdown: "3", "2", "1" beats (false start window open).
 * falseStart: 1.5 s banner, then countdown restarts.
 * running: from GO until the player crosses (or DNF at the event's cap).
 * finished: player crossed / DQ / DNF; runners keep moving in the run-out. `outcome` is set.
 */
export type RacePhase = 'intro' | 'countdown' | 'falseStart' | 'running' | 'finished';

/** 3, 2, 1 during the countdown; 'go' for the 0.6 s after GO; otherwise null. */
export type CountdownBeat = 3 | 2 | 1 | 'go' | null;

export type RunnerAnim =
  | 'idle'
  | 'walk'
  | 'ready1'
  | 'ready2'
  | 'run'
  | 'tired'
  | 'hurdle'
  | 'lean'
  | 'celebrate'
  | 'lose'
  | 'stumble';

/** Character-specific overlay effect currently active (design 3.3, 5.6, 15). */
export type RunnerEffect =
  'none' | 'wave' | 'overclock' | 'overheat' | 'warpOut' | 'warpIn' | 'sweat' | 'watch';

export interface RunnerState {
  /** Position in metres from the start line, interpolated for rendering (can be negative during intro). */
  readonly xM: number;
  /** Speed in m/s. */
  readonly vMps: number;
  readonly anim: RunnerAnim;
  /** Run cycle frame rate the view should use while anim === 'run' or 'tired' (design 5.6). */
  readonly runFps: number;
  readonly effect: RunnerEffect;
  /** False while Zyx is mid-warp. */
  readonly visible: boolean;
  /** Integer ms finish time once crossed, else null. */
  readonly finishMs: number | null;
  /** Feet height above the lane in metres (0 on the ground); views raise the sprite round(airM * 24) px. */
  readonly airM: number;
  /** Arc phase 0-1 while airborne (hurdle frame = floor(4 * s), clamp to 3), else null. */
  readonly airPhase: number | null;
  /** Per hurdle (10 in 110mh, [] otherwise): true once knocked. */
  readonly hurdlesKnocked: readonly boolean[];
  /** 0-1 stamina (400 m player only), else null. */
  readonly stamina: number | null;
}

export type RaceResult = 'win' | 'lose' | 'dq' | 'dnf';

export interface RaceOutcome {
  readonly event: EventId;
  readonly opponent: OpponentId;
  readonly result: RaceResult;
  /** Player ms, null for dq/dnf. */
  readonly ms: number | null;
  /** Opponent ms (always simulated to completion), null only for dq. */
  readonly oppMs: number | null;
  /** ms - oppMs when both exist (negative = player faster). */
  readonly marginMs: number | null;
  /** Equal ms, counts as a win. */
  readonly photoFinish: boolean;
  readonly falseStarts: number;
  readonly seed: number;
  /** Hurdles knocked by the player, CLIP plus HIT (110mh, 0-10), else null. */
  readonly hit: number | null;
  /** Player splits reached (400 m, up to 3 ms values at 100/200/300 m), else []. */
  readonly splits: readonly number[];
}

export interface RaceState {
  readonly event: EventId;
  readonly opponent: OpponentId;
  readonly seed: number;
  readonly phase: RacePhase;
  readonly countdown: CountdownBeat;
  /** Race clock in ms: 0 at GO, negative before GO is not exposed (0 until GO). Frozen while paused. */
  readonly raceMs: number;
  readonly falseStarts: number;
  readonly paused: boolean;
  /** True during the 0.5 s frozen "GET SET" beat after resume() (paused is already false). */
  readonly getSet: boolean;
  /**
   * What the HUD timer shows: 0 before GO, interpolated race ms while running, then frozen at the
   * player's finishMs (the event's DNF cap after DNF, 0 after DQ).
   */
  readonly timerMs: number;
  /** Side the player must press next; null before the first valid step (either side accepted). */
  readonly expectedSide: Side | null;
  /** Ms since the last valid step (for the "MASH!" prompt); 0 before GO. */
  readonly idleMs: number;
  readonly player: RunnerState;
  readonly rival: RunnerState;
  readonly outcome: RaceOutcome | null;
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

export type QuirkName =
  | 'trip'
  | 'wave'
  | 'fade'
  | 'coast'
  | 'kick'
  | 'overclock'
  | 'overheat'
  | 'warpOut'
  | 'warpIn'
  | 'pressure'
  | 'flashbulb'
  | 'watch'
  | 'sweat';

/** Things that happened during one advance() call, in order. Scenes map these to audio, HUD and FX. */
export type RaceEvent =
  | { readonly type: 'introDone' }
  | { readonly type: 'beat'; readonly beat: 3 | 2 | 1 | 'go' }
  /** A valid step. `airborne` is true for steps taken in the air (no impulse, no dust; 13.2). */
  | { readonly type: 'step'; readonly side: Side; readonly airborne?: boolean }
  | { readonly type: 'fumble'; readonly side: Side }
  | { readonly type: 'falseStart'; readonly count: number }
  | { readonly type: 'disqualified' }
  | { readonly type: 'playerFinish'; readonly ms: number }
  | { readonly type: 'rivalFinish'; readonly ms: number }
  | { readonly type: 'quirk'; readonly name: QuirkName }
  | { readonly type: 'dnf' }
  | { readonly type: 'resultReady'; readonly outcome: RaceOutcome }
  | { readonly type: 'jump'; readonly lane: Lane }
  | { readonly type: 'land'; readonly lane: Lane }
  | { readonly type: 'hurdleClear'; readonly lane: Lane; readonly index: number }
  | { readonly type: 'hurdleClip'; readonly lane: Lane; readonly index: number }
  | { readonly type: 'hurdleHit'; readonly lane: Lane; readonly index: number }
  /** Player, 400 m: index 0-2 for 100/200/300 m, ms is the interpolated crossing. */
  | { readonly type: 'split'; readonly index: number; readonly ms: number }
  /** Player passes 300 m (400 m). */
  | { readonly type: 'bell' }
  /** Every 0.6 s while S < S_FATIGUE (first one when S drops below). */
  | { readonly type: 'staminaLow' }
  /** S reaches 0, max once per 3 s. */
  | { readonly type: 'staminaEmpty' }
  /** Never from Race; reserved for records. */
  | { readonly type: 'eventUnlocked'; readonly event: EventId };

export interface RaceOptions {
  readonly event: EventId;
  readonly opponent: OpponentId;
  /** uint32 seed for opponent variance and the countdown's random "1" length. */
  readonly seed: number;
  /** performance.now()-origin time at which the race (intro) starts. */
  readonly startT: number;
}

/**
 * One race. Fixed 120 Hz simulation driven by an accumulator.
 * Usage per frame: feed RaceInputs via input() as they arrive, then call advance(now).
 * Inputs are applied at the tick matching their timestamp, not the frame they arrived in.
 * 'resultReady' fires 1.5 s after the player crosses (design 1.4.3), immediately for DQ/DNF.
 * Jump inputs only matter in the hurdles; elsewhere they are ignored (never a false start).
 *
 * Wiring notes:
 * - Pass performance.now()-origin times everywhere (Phaser's update `time` is fine).
 * - One advance() simulates at most 250 ms; longer stalls are dropped, not replayed.
 * - pause(now) on Esc, window blur and visibilitychange-hidden; resume(now) when the player picks
 *   RESUME (not on focus). After resume, state.getSet is true for 0.5 s and nothing moves.
 * - pause() flushes events up to `now`; they are returned by the next advance() call.
 * - RESTART / RETRY: construct a new Race (fresh seed via newSeed(); false starts reset).
 * - HUD timer: use state.timerMs (stops at the player's finish), not raceMs.
 * - Interpolated xM renders one tick (8.3 ms) behind the sim, the standard fixed-step blend.
 * - The opponent must be on the event's ladder (LADDERS[event]); otherwise the constructor throws.
 * - Rival hurdle events ('jump', 'land', 'hurdle*') carry lane 'rival'; the player's carry lane 'player'.
 */
export { Race } from './race/race.ts';

/** Fresh uint32 seed (Math.random based; tests pass explicit seeds instead). */
export function newSeed(): number {
  return (Math.random() * 0x100000000) >>> 0;
}

// ---------------------------------------------------------------------------
// Time formatting (design 4.1, 14.4, 16.5)
// ---------------------------------------------------------------------------

/**
 * formatTime: 11841 -> "11.85" (rounds UP to the hundredth); 64370 -> "1:04.37" from 60.00 s on.
 * null -> "--.--". Seconds are zero-padded to 2 digits.
 * formatLadderTotal: always M:SS.hh, e.g. 84100 -> "1:24.10"; null -> "-:--.--".
 * formatMargin: -760 -> "-0.76", 310 -> "+0.31", 0 -> "+0.00". Same ceil rule on the magnitude.
 * toKmh: m/s -> integer km/h (rounded).
 */
export { formatTime, formatLadderTotal, formatMargin, toKmh } from './format.ts';

// ---------------------------------------------------------------------------
// Records / save v2 (design 16)
// ---------------------------------------------------------------------------

export interface Settings {
  /** 0-10 */
  readonly volume: number;
  readonly muted: boolean;
  readonly reducedFlashing: boolean;
  readonly screenShake: boolean;
  /** Optional CRT post-effect (research 3). */
  readonly crt: boolean;
  /** Android vibration (design 17.7), default true. */
  readonly haptics: boolean;
}

export interface BestTime {
  readonly ms: number;
  readonly at: string;
  /** Hurdles: knocked hurdles in the PB race (0-10); absent for migrated or older PBs. */
  readonly hit?: number;
  /** 400 m: the PB race's three splits; absent for older PBs. */
  readonly splits?: readonly number[];
}

export interface HistoryEntry {
  readonly opp: OpponentId;
  readonly result: RaceResult;
  readonly ms: number | null;
  readonly oppMs: number | null;
  readonly falseStarts: number;
  readonly seed: number;
  readonly at: string;
  /** Hurdles only (always present there): knocked hurdles 0-10. */
  readonly hit?: number;
  /** 400 m only (always present there): splits reached, 0-3 values. */
  readonly splits?: readonly number[];
}

export interface EventRecords {
  readonly unlockedTier: number;
  readonly beaten: readonly OpponentId[];
  readonly champion: boolean;
  readonly best: Readonly<Partial<Record<OpponentId, BestTime>>>;
  readonly history: readonly HistoryEntry[];
}

export interface SaveData {
  readonly version: 2;
  readonly lastEvent: EventId;
  readonly seenEvents: readonly EventId[];
  readonly hints: { readonly addToHomeScreen: boolean };
  readonly settings: Settings;
  readonly events: Readonly<Record<EventId, EventRecords>>;
}

/** Minimal string key-value port; window.localStorage satisfies it. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface RecordOutcome {
  readonly newPb: boolean;
  /** PB before this race, null if none. */
  readonly previousPbMs: number | null;
  /** Next rival in the same event unlocked by this race (first win only), else null. */
  readonly unlocked: OpponentId | null;
  /** Event unlocked by this race (design 12.2), else null. */
  readonly unlockedEvent: EventId | null;
  /** True only on the first ever tier 7 win in this event. */
  readonly becameChampion: boolean;
}

/**
 * RecordsStore.load(storage): v2 load plus v1 migration (design 16.4). Never throws on storage
 * failure; `persistent` turns false and the store keeps working in memory.
 */
export { SAVE_KEY_V1, SAVE_KEY, CORRUPT_KEY, RecordsStore } from './records/store.ts';

/** window.localStorage if usable (probe write), else null. Safe to call in Node (returns null). */
export { browserStorage } from './platform/storage.ts';
