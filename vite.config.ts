import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  build: { target: 'es2023', chunkSizeWarningLimit: 2000 },
  plugins: [
    // Precaching service worker for offline play from the Home Screen (research-mobile 5).
    // The manifest is the hand-written public/manifest.webmanifest, linked from index.html.
    // main.ts registers the worker (never in test builds); `prompt` means no skipWaiting, so a new
    // version takes over on the next cold launch and never reloads the page mid-race.
    VitePWA({
      strategies: 'generateSW',
      registerType: 'prompt',
      injectRegister: false,
      manifest: false,
      devOptions: { enabled: false },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2,webmanifest}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
});
