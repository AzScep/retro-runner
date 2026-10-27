/**
 * Production build of the art preview (`npx vite build --config tools/art/vite.preview.config.ts`,
 * then `npx vite preview --config tools/art/vite.preview.config.ts`), for frame-time checks of
 * RaceView with the game's real build settings (trimmed Phaser, flags). Output goes to
 * node_modules/.cache/art-preview (ignored by lint, format and git).
 */
import { fileURLToPath } from 'node:url';
import { defineConfig, type PluginOption } from 'vite';
import base from '../../vite.config.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
const plugins = (base.plugins ?? []) as PluginOption[];

export default defineConfig({
  ...base,
  // The game's first plugin resolves Phaser's build flags; the PWA plugin is not needed here.
  plugins: [plugins[0]],
  root,
  build: {
    outDir: fileURLToPath(new URL('../../node_modules/.cache/art-preview', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: { input: fileURLToPath(new URL('./preview.html', import.meta.url)) },
  },
  preview: { port: 5198, strictPort: true },
});
