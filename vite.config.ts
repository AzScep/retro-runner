import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

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
  return {
    name: 'phaser-flags',
    enforce: 'pre',
    transform(code, id) {
      if (!id.startsWith(PHASER_SRC) || !code.includes('typeof ')) return null;
      const out = code.replace(FLAG_RE, (_, flag: string) => String(PHASER_FLAGS[flag]));
      return out === code ? null : { code: out, map: null };
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [phaserFlags()],
  resolve: {
    alias: [
      // The game imports `phaser`; the bundle gets the trimmed build in src/phaser-build.js.
      { find: /^phaser$/, replacement: fileURLToPath(new URL('./src/phaser-build.js', import.meta.url)) },
      { find: /^phaser-src\//, replacement: PHASER_SRC },
    ],
  },
  // The main chunk is ~830 KB with the trimmed Phaser build (1.5 MB with the full dist file), so a
  // warning here means the bundle has regressed.
  build: { target: 'es2023', chunkSizeWarningLimit: 900 },
});
