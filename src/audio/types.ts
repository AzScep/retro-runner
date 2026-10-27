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
  | 'stamina_empty';

/**
 * `race` and `hurdles` are transposed per tier; tier 7 (Zyx) plays the boss track in every event.
 * `quarter` (400 m) is one untransposed song rendered twice: base and "final 100".
 */
export type MusicId = 'title' | 'ladder' | 'race' | 'boss' | 'champion' | 'hurdles' | 'quarter';

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
];

export const MUSIC_IDS: readonly MusicId[] = [
  'title',
  'ladder',
  'race',
  'boss',
  'champion',
  'hurdles',
  'quarter',
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
