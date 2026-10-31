import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/** Phaser's build-time feature flags (its own webpack config sets them with DefinePlugin). */
const PHASER_FLAGS: Readonly<Record<string, boolean>> = {
  CANVAS_RENDERER: false,
  WEBGL_RENDERER: true,
  WEBGL_DEBUG: false,
  FEATURE_SOUND: false,
  PLUGIN_CAMERA3D: false,
  PLUGIN_FBINSTANT: false,
};
const FLAG_RE = new RegExp(`typeof (${Object.keys(PHASER_FLAGS).join('|')})\\b`, 'g');
const PHASER_SRC = fileURLToPath(new URL('./node_modules/phaser/src/', import.meta.url));

/**
 * Resolves `typeof FLAG` in phaser/src to a constant so the minifier drops the disabled branches.
 * `typeof X` is not an identifier, so Vite's `define` cannot replace it.
 */
function phaserFlags(): Plugin {
  return { name: 'phaser-flags', enforce: 'pre', transform: resolvePhaserFlags };
}

function resolvePhaserFlags(code: string, id: string): { code: string; map: null } | null {
  if (!id.startsWith(PHASER_SRC) || !code.includes('typeof ')) return null;
  const out = code.replace(FLAG_RE, (_, flag: string) => String(PHASER_FLAGS[flag]));
  return out === code ? null : { code: out, map: null };
}

export default defineConfig({
  base: './',
  plugins: [
    phaserFlags(),
    // Precaching service worker for offline play from the Home Screen (research-mobile 5).
    // The manifest is the hand-written public/manifest.webmanifest, linked from index.html.
    // main.ts registers the worker (never in test builds). The plugin's register code reloads the
    // page itself when an updated worker takes control unless onNeedReload is given, so main.ts
    // passes one that waits for a menu screen.
    VitePWA({
      strategies: 'generateSW',
      registerType: 'prompt',
      injectRegister: false,
      manifest: false,
      devOptions: { enabled: false },
      workbox: {
        // A new deploy's worker takes over as soon as it is installed, so a returning visitor
        // (including one stuck on an older build that waited for a cold launch) gets it on the
        // next load; main.ts reloads an open page into it only on a visible menu screen, never
        // over a race (running or paused) or a Gauntlet run (src/ui/updateReload.ts).
        skipWaiting: true,
        clientsClaim: true,
        globPatterns: ['**/*.{js,css,html,png,svg,woff2,webmanifest}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  resolve: {
    alias: [
      // The game imports `phaser`; the bundle gets the trimmed build in src/phaser-build.js.
      { find: /^phaser$/, replacement: fileURLToPath(new URL('./src/phaser-build.js', import.meta.url)) },
      { find: /^phaser-src\//, replacement: PHASER_SRC },
    ],
  },
  // The dev server pre-bundles phaser/src (CommonJS) with Rolldown, which does not run Vite plugins,
  // so the flags must be resolved there too; otherwise the WEBGL_DEBUG branch keeps its
  // require('phaser3spectorjs') and the dev page throws on load.
  optimizeDeps: {
    rolldownOptions: { plugins: [{ name: 'phaser-flags-deps', transform: resolvePhaserFlags }] },
  },
  // The main chunk is ~920 KB with the trimmed Phaser build (1.6 MB with the full dist file), so a
  // warning here means the bundle has regressed.
  build: {
    target: 'es2023',
    chunkSizeWarningLimit: 1000,
    // The game at / and the landing page at /welcome/ (src/landing/README.md).
    rolldownOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        welcome: fileURLToPath(new URL('./welcome/index.html', import.meta.url)),
      },
    },
  },
});
