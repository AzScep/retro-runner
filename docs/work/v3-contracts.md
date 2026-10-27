# Expansion v3 (multi-runner) - cross-team contracts

Temporary work doc for the v3 expansion: 6-runner races, field cohorts, Zyx reveal, meets and officials, Gauntlet, trip flag, records v3.
Spec: `docs/design.md` sections 23-38 (authoritative); evidence: `docs/research-sprinter.md`, `tools/prototype/`.
Delete this file and `tools/prototype/` once v3 ships.

Each layer exposes its API only through its `index.ts`.
Signatures here are binding; owners may ADD exports, and any change to what is listed needs the orchestrator.
Until an owner lands a piece, consumers may see type errors for it mid-flight; never stub it in someone else's folder.

## Ownership

| Agent | Owns (may edit) |
|---|---|
| MECHANICS | `src/core/**` |
| ART | `src/art/**`, `tools/art/**` |
| AUDIO | `src/audio/**`, `tools/audio/**` |
| UI | `src/scenes/**`, `src/ui/**`, `src/touch/**`, `src/main.ts`, `e2e/**` |
| Orchestrator | configs, `package.json`, lockfile, docs, `tools/prototype/**` |

Nobody runs `npm install`; ask the orchestrator for dependencies or config changes.
Plain dash only, never the em dash character.
No commits.

## Core (MECHANICS)

### Field and meets

```ts
export type FieldBodyId = 'fKid' | 'fTeen' | 'fStudent' | 'fClub' | 'fElite' | 'fBot' | 'fDrone';
export type FieldVariant = 'A' | 'B' | 'C' | 'D';
export interface FieldRunnerInfo {
  readonly tier: number;          // 1-7
  readonly body: FieldBodyId;
  readonly variant: FieldVariant;
  readonly name: string;          // 'DOT', 'MK-2', 'ZX-1' (design 24.3)
}
/** The 4 field runners of a tier (design 24.2-24.3), same in every event. */
export function fieldRunners(tier: number): readonly FieldRunnerInfo[];
export const FIELD_SIZE = 6;

export interface MeetInfo { readonly tier: number; readonly name: string } // 'SPORTS DAY' ... 'GALACTIC MEET'
export function meet(tier: number): MeetInfo;
```

### Race

```ts
export type RaceMode = 'l' | 'g'; // ladder, Gauntlet
export interface RaceOptions {
  readonly event: EventId; readonly opponent: OpponentId; readonly seed: number; readonly startT: number;
  readonly mode?: RaceMode;     // default 'l'
  readonly trip?: boolean;      // default TUNING.TRIP_ENABLED (false)
}

/** Input events gain their source so the trip can be keyboard-only (design 33.1). */
export interface RunKeyEvent { /* v2 fields */ readonly source?: 'k' | 't' } // default 'k'
export interface JumpEvent { /* v2 fields */ readonly source?: 'k' | 't' }

export type RunnerKind = 'player' | 'rival' | 'field';
/** Who runs in a lane: a roster character (player, named rival) or a field runner. */
export type LaneCharacter =
  | { readonly kind: 'player' | 'rival'; readonly id: CharacterId }
  | { readonly kind: 'field'; readonly field: FieldRunnerInfo };

export interface LaneRunner {
  readonly lane: number;            // 0 = nearest (player), 1 = named rival, 2-5 = field
  readonly who: LaneCharacter;
  readonly name: string;            // 'RIO', 'PIP', 'DOT'
  readonly state: RunnerState;      // v2 RunnerState, unchanged shape
}

// RunnerAnim gains 'fall' | 'lie' | 'getup' (player trip).
export interface RaceState {
  // all v2 fields unchanged; `player` === runners[0].state, `rival` === runners[1].state
  readonly runners: readonly LaneRunner[];  // length FIELD_SIZE, index = lane
  /** Raw live place of the player (design 27.2 rule 1), null before GO and after DQ. UI applies the 0.35 s hold. */
  readonly livePlace: number | null;
  /** Lane of the current race leader (true distance or finish order). */
  readonly leaderLane: number;
  /** Player trip phase. */
  readonly trip: 'none' | 'fall' | 'lie' | 'getup';
}

// RaceEvent changes:
// - Every event that had `lane: Lane` ('player' | 'rival') now carries `lane: number` (0 = player, 1 = rival, 2-5 = field):
//   jump, land, hurdleClear, hurdleClip, hurdleHit. `Lane` is removed.
// - New:
//   | { type: 'runnerFinish'; lane: number; ms: number }            // every runner incl. player and rival
//   | { type: 'closeFinish' }                                      // 1st-2nd margin <= PHOTO_MARGIN_MS (judges)
//   | { type: 'trip' } | { type: 'tripUp' }                        // player
//   | { type: 'placeChange'; place: number }                       // raw player place changed (UI holds it)
// - 'rivalFinish' stays (named rival) for compatibility.

export interface Standing {
  readonly lane: number; readonly who: LaneCharacter; readonly name: string;
  readonly ms: number | null;       // null: player DQ/DNF
  readonly place: number | null;    // shared place on ties; null for player DQ/DNF
}
export interface RaceOutcome {
  // all v2 fields unchanged (`oppMs` stays the NAMED rival's time)
  readonly mode: RaceMode;
  readonly place: number | null;     // player place, null for DQ/DNF
  readonly fieldSize: number;        // 6
  readonly winMs: number | null;     // winning time of the race (any runner)
  readonly standings: readonly Standing[]; // sorted by place, player DQ/DNF last
  readonly steps: number; readonly fumbles: number; readonly fumble2: number; readonly trips: number;
  readonly input: 'k' | 't' | 'm';
}
// result: 'win' iff place === 1 (incl. dead heat); 'lose' for 2-6; 'dq' / 'dnf' as before.
```

### Records v3

```ts
export const SAVE_KEY = 'retroRunner.save.v3';
export const SAVE_KEY_V2 = 'retroRunner.save.v2';
// SAVE_KEY_V1, CORRUPT_KEY unchanged.

export interface GauntletRecord {
  readonly runs: number; readonly clears: number; readonly furthest: number;
  readonly best: { readonly ms: number; readonly at: string; readonly times: readonly number[] } | null;
}
// EventRecords gains: revealed: boolean; place: Partial<Record<OpponentId, number>>; gauntlet: GauntletRecord.
// HistoryEntry gains: place, fieldSize, winMs, mode, and optional steps, fumbles, fumble2, trips, input.
// SaveData: version 3; hints gains revealSeen: boolean.

export interface RecordOutcome {
  // v2 fields unchanged (unlocked = next rival after a 1st place)
  readonly place: number | null;
  readonly newBestPlace: number | null;   // set when this race improved the best placing (2 or 3 -> medal row)
  readonly revealPending: boolean;        // 1st vs tier 6 with revealed = false (results show CONTINUE)
}
export interface GauntletEnd { readonly cleared: boolean; readonly furthest: number; readonly times: readonly number[] }
export interface GauntletOutcome { readonly newBest: boolean; readonly newFurthest: boolean; readonly previousBestMs: number | null }

// RecordsStore additions (all v2 methods keep working):
//   isUnlocked(event, 'zyx') is false until revealed(event) is true.
//   bestPlace(event: EventId, id: OpponentId): number | null;
//   isRevealed(event: EventId): boolean;
//   revealPending(event: EventId): boolean;     // tier 6 beaten and not revealed (design 30.1.5)
//   markRevealed(event: EventId): void;         // also sets hints.revealSeen; saves
//   revealSeen(): boolean;                      // hints.revealSeen (full vs short reveal)
//   isGauntletUnlocked(event: EventId): boolean;
//   gauntlet(event: EventId): GauntletRecord;
//   recordGauntletEnd(event: EventId, end: GauntletEnd, at: Date): GauntletOutcome;
```

Load order and migration v2 -> v3 (and v1 -> v2 -> v3) exactly as design 34.4.

### Tunables

`TUNING` gains the v3 constants of design section 11 (FIELD_PACE_LO/HI, FIELD_SEED_XOR, FIELD_FLOOR_PCT, TRIP_ENABLED, TRIP_WINDOW, TRIP_BLEED, TRIP_LIE, TRIP_KEEP, POSITION_HOLD, PHOTO_MARGIN_MS, JUDGE_LEAN_M, MEET_CARD_SHOW, REVEAL_SKIP_AFTER, GAUNTLET_NEXT_DELAY).

## Art (ART)

```ts
/** Lane geometry (prototype layout R, design 26.1-26.3). */
export const LANE_FEET_Y: readonly number[];   // [157, 143, 132, 123, 115, 108], index = lane
export const LANE_OBLIQUE_PX = 10;              // per lane, to the right

// RaceView keeps its constructor and update(state, events) signature and now draws all
// state.runners in layout R with draw order far lane first, per-lane hurdles, 6-lane track,
// starter official (pose driven by countdown/falseStart/beat events), pistol smoke, judges
// (lean/stand from runner distances, closeFinish and trip events), photo-finish camera light,
// field runner anims (hurdle/HIT/celebrate/lose), Rio fall/lie/getup.
// rivalScreenX() stays. Additions:
//   runnerScreenPos(lane: number): { x: number; y: number }   // feet position on screen, may be off-screen
//   starterScreenPos(): { x: number; y: number }              // for UI speech bubbles (null-safe: off-screen allowed)

export function fieldPortraitKey(field: FieldRunnerInfo): string;   // 16x16
export function createFieldSprite(scene: Phaser.Scene, field: FieldRunnerInfo, x: number, y: number): Phaser.GameObjects.Sprite; // anim keys documented by ART
export function meetBadgeKey(tier: number): string;                // 16x16
export type MedalTier = 1 | 2 | 3;
export function medalPipKey(place: MedalTier): string;             // 6x6 with digit
export function medalKey(place: MedalTier): string;                // 8x8
// IconId gains 'finishFlagSmall' (8x8) and 'offscreenArrowLeft' (8x8).
/** Reveal props for the UI's reveal scene (design 30.2). */
export function createLandingBeam(scene: Phaser.Scene, x: number, y: number, opts: { readonly reducedFlashing: boolean }): Phaser.GameObjects.Sprite;
/** 9-slice speech bubble texture keys for the UI (index 8 fill, index 1 outline, 3x3 tail). */
export const SPEECH_BUBBLE: { readonly key: string; readonly corner: number; readonly tailKey: string };
```

Speech bubble TEXT is drawn by UI (it owns the fonts); ART owns only the bubble art.

## Audio (AUDIO)

```ts
export type SfxId = /* v2 ids */ | 'pistol' | 'trip_thud' | 'reveal_sting_1' | 'reveal_sting_2' | 'photo_click' | 'bubble' | 'gauntlet_clear';
export type MusicId = /* v2 ids */ | 'gauntlet';
// Field hurdle SFX: UI calls playSfx('hurdle_clip' | 'hurdle_hit', { volume: 0.25 }); AUDIO rate-limits field hurdle SFX to 1 per 100 ms
// when called with a new option { field: true } (additive to the v2 opts).
```

## UI (UI)

UI owns all screens and flows of design 27-32 (HUD v3 with the 0.35 s place hold, results card v3, ladder medals and hidden tier 7, records v3, S11 Gauntlet cards, S12 reveal scene, meet cards, starter speech bubbles via `RaceView.starterScreenPos()`, TRIP! popup), plus the small touch changes of 27.6 in `src/touch` (1 px over-canvas pad borders, MASH! at y 92) and tagging touch input with `source: 't'`.
The keyboard adapter in core tags `source: 'k'`.
