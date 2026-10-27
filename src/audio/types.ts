/** Shared audio identifiers. Re-exported unchanged from ./index.ts (the cross-team contract). */

export type SfxId =
  | 'step_l'
  | 'step_r'
  | 'fumble'
  | 'beep_count'
  | 'beep_go'
  | 'false_start'
  | 'finish'
  | 'win_jingle'
  | 'lose_jingle'
  | 'new_pb'
  | 'unlock'
  | 'menu_move'
  | 'menu_select'
  | 'menu_back'
  | 'warp'
  | 'overheat'
  | 'flashbulb'
  // v2 (design 20.1)
  | 'jump'
  | 'land'
  | 'hurdle_clip'
  | 'hurdle_hit'
  | 'split'
  | 'bell'
  | 'stamina_low'
  | 'stamina_empty'
  // v3 (design 36.1)
  | 'pistol'
  | 'trip_thud'
  | 'reveal_sting_1'
  | 'reveal_sting_2'
  | 'photo_click'
  | 'bubble'
  | 'gauntlet_clear';

/**
 * `race` and `hurdles` are transposed per tier; tier 7 (Zyx) plays the boss track in every event.
 * `quarter` (400 m) is one untransposed song rendered twice: base and "final 100".
 * `gauntlet` (v3, design 36.2) is one track for Gauntlet tiers 1-6 and the cards between them.
 */
export type MusicId = 'title' | 'ladder' | 'race' | 'boss' | 'champion' | 'hurdles' | 'quarter' | 'gauntlet';

export const SFX_IDS: readonly SfxId[] = [
  'step_l',
  'step_r',
  'fumble',
  'beep_count',
  'beep_go',
  'false_start',
  'finish',
  'win_jingle',
  'lose_jingle',
  'new_pb',
  'unlock',
  'menu_move',
  'menu_select',
  'menu_back',
  'warp',
  'overheat',
  'flashbulb',
  'jump',
  'land',
  'hurdle_clip',
  'hurdle_hit',
  'split',
  'bell',
  'stamina_low',
  'stamina_empty',
  'pistol',
  'trip_thud',
  'reveal_sting_1',
  'reveal_sting_2',
  'photo_click',
  'bubble',
  'gauntlet_clear',
];

export const MUSIC_IDS: readonly MusicId[] = [
  'title',
  'ladder',
  'race',
  'boss',
  'champion',
  'hurdles',
  'quarter',
  'gauntlet',
];

/** Mono or stereo PCM rendered at `sampleRate`. */
export interface Pcm {
  readonly sampleRate: number;
  readonly channels: readonly Float32Array[];
  /**
   * Same-length alternate mix of the same song (the quarter track's "final 100": base plus added
   * lead and drums), normalised with the same gain so a crossfade between the two is seamless.
   */
  readonly final?: readonly Float32Array[];
}
