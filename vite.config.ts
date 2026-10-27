import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { target: 'es2023', chunkSizeWarningLimit: 2000 },
});
