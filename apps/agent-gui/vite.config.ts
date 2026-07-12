import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * GUI-002 renderer build. Electron loads `dist/renderer/index.html` via `loadFile` (relative `base` so the
 * `file://` load resolves assets), and the renderer connects to the sidecar over loopback WS. Vite owns the
 * browser ESM bundle independently of the (CommonJS) Electron main/preload build.
 */
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist/renderer',
    emptyOutDir: true,
    // The renderer runs only in Electron's bundled (recent) Chromium — no legacy-browser down-transpile.
    target: 'esnext',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
  },
});
