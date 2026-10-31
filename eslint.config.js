import tseslint from 'typescript-eslint';

// Flat config: a later block's `no-restricted-imports` replaces an earlier one for the same file, so
// every layer gets exactly one block with its complete list.
const restrict = (patterns) => ({
  'no-restricted-imports': ['error', { patterns }],
});

const noTouch = { group: ['**/touch', '**/touch/**'], message: 'Only src/main.ts imports src/touch.' };

export default tseslint.config(
  {
    ignores: [
      'dist',
      'node_modules',
      'playwright-report',
      'test-results',
      'src/audio/vendor',
      '.claude/worktrees',
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/core/**/*.ts'],
    rules: restrict([
      { group: ['phaser', 'phaser/*'], message: 'src/core is pure TS: no Phaser.' },
      {
        group: ['**/art/**', '**/audio/**', '**/ui/**', '**/scenes/**'],
        message: 'src/core must not depend on other layers.',
      },
      noTouch,
    ]),
  },
  {
    files: ['src/art/**/*.ts'],
    rules: restrict([
      { group: ['**/ui/**', '**/scenes/**', '**/audio/**'], message: 'art may depend only on src/core.' },
      { group: ['**/core/*/**'], message: 'Import core only through src/core/index.ts.' },
      noTouch,
    ]),
  },
  {
    files: ['src/audio/**/*.ts'],
    rules: restrict([
      { group: ['**/ui/**', '**/scenes/**', '**/art/**'], message: 'audio may depend only on src/core.' },
      { group: ['**/core/*/**'], message: 'Import core only through src/core/index.ts.' },
      { group: ['phaser', 'phaser/*'], message: 'audio is engine-free Web Audio.' },
      noTouch,
    ]),
  },
  {
    files: ['src/ui/**/*.ts', 'src/scenes/**/*.ts'],
    rules: restrict([
      {
        group: ['**/core/*/**', '**/art/*/**', '**/audio/*/**'],
        message: 'Import other layers only through their index.ts.',
      },
      noTouch,
    ]),
  },
  {
    files: ['src/landing/**/*.ts'],
    rules: restrict([
      { group: ['phaser', 'phaser/*', 'phaser-src/*'], message: 'The landing page never loads Phaser.' },
      {
        group: ['**/scenes/**', '**/ui/**'],
        message: 'The landing page does not use game scenes or game UI.',
      },
      noTouch,
    ]),
  },
  {
    files: ['src/touch/**/*.ts'],
    rules: restrict([
      {
        group: ['phaser', 'phaser/*', '**/scenes/**', '**/audio/**'],
        message: 'touch is a DOM layer over the game.',
      },
      {
        group: ['**/ui/**', '!**/ui/tapTargets.ts'],
        message: 'touch may import only src/ui/tapTargets.ts from ui.',
      },
      { group: ['**/core/*/**', '**/art/*/**'], message: 'Import other layers only through their index.ts.' },
    ]),
  },
);
