/** Phaser scene keys. Phaser-free so pure modules and their tests can check against them. */
export const SceneKey = {
  Boot: 'Boot',
  Title: 'Title',
  Events: 'Events',
  Ladder: 'Ladder',
  Records: 'Records',
  Options: 'Options',
  Champion: 'Champion',
  Race: 'Race',
  Hud: 'Hud',
  Results: 'Results',
  Pause: 'Pause',
  Gauntlet: 'Gauntlet',
  Reveal: 'Reveal',
} as const;
export type SceneKey = (typeof SceneKey)[keyof typeof SceneKey];
