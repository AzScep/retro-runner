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
  | 'flashbulb';

/** `race` is transposed per tier; tier 7 uses the boss track. */
export type MusicId = 'title' | 'ladder' | 'race' | 'boss' | 'champion';

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
];

export const MUSIC_IDS: readonly MusicId[] = ['title', 'ladder', 'race', 'boss', 'champion'];

/** Mono or stereo PCM rendered at `sampleRate`. */
export interface Pcm {
  readonly sampleRate: number;
  readonly channels: readonly Float32Array[];
}
