import tseslint from 'typescript-eslint';

const restrict = (patterns) => ({
  'no-restricted-imports': ['error', { patterns }],
});

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'playwright-report', 'test-results', 'src/audio/vendor'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/core/**/*.ts'],
    ignores: ['src/core/input/adapter.ts', 'src/core/platform/**'],
    rules: restrict([
      { group: ['phaser', 'phaser/*'], message: 'src/core is pure TS: no Phaser.' },
      {
        group: ['**/art/**', '**/audio/**', '**/ui/**', '**/scenes/**'],
        message: 'src/core must not depend on other layers.',
      },
    ]),
  },
  {
    files: ['src/art/**/*.ts'],
    rules: restrict([
      { group: ['**/ui/**', '**/scenes/**', '**/audio/**'], message: 'art may depend only on src/core.' },
      { group: ['**/core/*/**'], message: 'Import core only through src/core/index.ts.' },
    ]),
  },
  {
    files: ['src/audio/**/*.ts'],
    rules: restrict([
      { group: ['**/ui/**', '**/scenes/**', '**/art/**'], message: 'audio may depend only on src/core.' },
      { group: ['**/core/*/**'], message: 'Import core only through src/core/index.ts.' },
      { group: ['phaser', 'phaser/*'], message: 'audio is engine-free Web Audio.' },
    ]),
  },
  {
    files: ['src/ui/**/*.ts', 'src/scenes/**/*.ts'],
    rules: restrict([
      {
        group: ['**/core/*/**', '**/art/*/**', '**/audio/*/**'],
        message: 'Import other layers only through their index.ts.',
      },
    ]),
  },
);
