/**
 * Public API of the game core (owner: MECHANICS).
 *
 * Pure TypeScript: no Phaser, no DOM, except `attachKeyboard` which lives in input/adapter.ts.
 * Other layers import only from this file. Signatures here are the cross-team contract:
 * implementations may move into subfolders, but names, shapes and semantics must not change
 * without the orchestrator's agreement.
 *
 * Spec: docs/design.md sections 1-4 and 11. Timing approach: docs/research.md section 7.
 */

// ---------------------------------------------------------------------------
// Roster
// ---------------------------------------------------------------------------

export type OpponentId = 'pip' | 'jess' | 'marco' | 'kofi' | 'valentina' | 'unit7' | 'zyx';
export type CharacterId = OpponentId | 'rio';

export interface OpponentInfo {
  readonly id: OpponentId;
  /** 1-7, ladder order. */
  readonly tier: number;
  /** Display name, e.g. "UNIT-7". */
  readonly name: string;
  /** Who they are, e.g. "Primary school student". */
  readonly who: string;
  /** Design target finish time in ms (design 3.2). */
  readonly targetMs: number;
  /** One-line flavour text for the ladder card. */
  readonly flavour: string;
}

export { OPPONENT_IDS, OPPONENTS, PLAYER, WORLD, TUNING } from './roster.ts';

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export type Side = 'L' | 'R';

/** A raw run-key event. `t` is a DOMHighResTimeStamp on the performance.now() origin. */
export interface RunKeyEvent {
  readonly kind: 'down' | 'up';
  readonly side: Side;
  readonly t: number;
  readonly repeat: boolean;
}

/**
 * Listens on `target` (capture phase) for ArrowLeft/KeyA and ArrowRight/KeyD (by event.code),
 * prevents default for them, and forwards RunKeyEvents with event.timeStamp.
 * Returns a detach function.
 */
export { attachKeyboard } from './input/adapter.ts';

// ---------------------------------------------------------------------------
// Race simulation
// ---------------------------------------------------------------------------

/**
 * intro: runners walk to the blocks (1.5 s) then crouch.
 * countdown: "3", "2", "1" beats (false start window open).
 * falseStart: 1.5 s banner, then countdown restarts.
 * running: from GO until the player crosses (or DNF at 30 s).
 * finished: player crossed / DQ / DNF; runners keep moving in the run-out. `outcome` is set.
 */
export type RacePhase = 'intro' | 'countdown' | 'falseStart' | 'running' | 'finished';

/** 3, 2, 1 during the countdown; 'go' for the 0.6 s after GO; otherwise null. */
export type CountdownBeat = 3 | 2 | 1 | 'go' | null;

export type RunnerAnim =
  'idle' | 'walk' | 'ready1' | 'ready2' | 'run' | 'lean' | 'celebrate' | 'lose' | 'stumble';

/** Character-specific overlay effect currently active (design 3.3, 5.6). */
export type RunnerEffect = 'none' | 'wave' | 'overclock' | 'overheat' | 'warpOut' | 'warpIn';

export interface RunnerState {
  /** Position in metres from the start line, interpolated for rendering (can be negative during intro). */
  readonly xM: number;
  /** Speed in m/s. */
  readonly vMps: number;
  readonly anim: RunnerAnim;
  /** Run cycle frame rate the view should use while anim === 'run' (design 5.6). */
  readonly runFps: number;
  readonly effect: RunnerEffect;
  /** False while Zyx is mid-warp. */
  readonly visible: boolean;
  /** Integer ms finish time once crossed, else null. */
  readonly finishMs: number | null;
}

export type RaceResult = 'win' | 'lose' | 'dq' | 'dnf';

export interface RaceOutcome {
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
}

export interface RaceState {
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
   * player's finishMs (30000 after DNF, 0 after DQ).
   */
  readonly timerMs: number;
  /** Side the player must press next; null before the first valid step (either side accepted). */
  readonly expectedSide: Side | null;
  /** Ms since the last valid step (for the "MASH!" prompt); 0 before GO. */
  readonly idleMs: number;
  readonly player: RunnerState;
  readonly rival: RunnerState;
  readonly outcome: RaceOutcome | null;
}

/** Things that happened during one advance() call, in order. Scenes map these to audio, HUD and FX. */
export type RaceEvent =
  | { readonly type: 'introDone' }
  | { readonly type: 'beat'; readonly beat: 3 | 2 | 1 | 'go' }
  | { readonly type: 'step'; readonly side: Side }
  | { readonly type: 'fumble'; readonly side: Side }
  | { readonly type: 'falseStart'; readonly count: number }
  | { readonly type: 'disqualified' }
  | { readonly type: 'playerFinish'; readonly ms: number }
  | { readonly type: 'rivalFinish'; readonly ms: number }
  | {
      readonly type: 'quirk';
      readonly name:
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
        | 'flashbulb';
    }
  | { readonly type: 'dnf' }
  | { readonly type: 'resultReady'; readonly outcome: RaceOutcome };

export interface RaceOptions {
  readonly opponent: OpponentId;
  /** uint32 seed for opponent variance and the countdown's random "1" length. */
  readonly seed: number;
  /** performance.now()-origin time at which the race (intro) starts. */
  readonly startT: number;
}

/**
 * One race. Fixed 120 Hz simulation driven by an accumulator.
 * Usage per frame: feed RunKeyEvents via input() as they arrive, then call advance(now).
 * Key events are applied at the tick matching their timestamp, not the frame they arrived in.
 * 'resultReady' fires 1.5 s after the player crosses (design 1.4.3), immediately for DQ/DNF.
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
 */
export { Race } from './race/race.ts';

/** Fresh uint32 seed (Math.random based; tests pass explicit seeds instead). */
export function newSeed(): number {
  return (Math.random() * 0x100000000) >>> 0;
}

// ---------------------------------------------------------------------------
// Time formatting (design 4.1)
// ---------------------------------------------------------------------------

/** 11841 -> "11.85" (rounds UP to the hundredth). null -> "--.--". Seconds are zero-padded to 2 digits. */
export { formatTime } from './format.ts';

/** -760 -> "-0.76", 310 -> "+0.31", 0 -> "+0.00". Same ceil rule applied to the magnitude. */
export { formatMargin } from './format.ts';

/** m/s -> integer km/h (rounded). */
export { toKmh } from './format.ts';

// ---------------------------------------------------------------------------
// Records / save (design 4.2-4.5)
// ---------------------------------------------------------------------------

export interface Settings {
  readonly volume: number; // 0-10
  readonly muted: boolean;
  readonly reducedFlashing: boolean;
  readonly screenShake: boolean;
  /** Optional CRT post-effect (research 3). */
  readonly crt: boolean;
}

export interface BestTime {
  readonly ms: number;
  readonly at: string;
}

export interface HistoryEntry {
  readonly opp: OpponentId;
  readonly result: RaceResult;
  readonly ms: number | null;
  readonly oppMs: number | null;
  readonly falseStarts: number;
  readonly seed: number;
  readonly at: string;
}

export interface SaveData {
  readonly version: 1;
  readonly unlockedTier: number;
  readonly beaten: readonly OpponentId[];
  readonly champion: boolean;
  readonly best: Readonly<Partial<Record<OpponentId, BestTime>>>;
  readonly history: readonly HistoryEntry[];
  readonly settings: Settings;
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
  /** Rival unlocked by this race (first win only), else null. */
  readonly unlocked: OpponentId | null;
  /** True only on the first ever win vs Zyx. */
  readonly becameChampion: boolean;
}

export { SAVE_KEY, CORRUPT_KEY, RecordsStore } from './records/store.ts';

/** window.localStorage if usable (probe write), else null. Safe to call in Node (returns null). */
export { browserStorage } from './platform/storage.ts';
