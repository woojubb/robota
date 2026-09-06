import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * GUI-007 — the CLI-served monitor SPA build. Single static entry: the localhost monitor (`index.html` →
 * `SessionMonitor` from the GUI core). `agent-cli` copies this package's `dist/` into `dist/web` and serves it
 * over localhost HTTP (the Stage-D browser remote page lives in `apps/agent-web` `/remote`, not here).
 */
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // The renderer runs in recent browsers only — no legacy down-transpile.
    target: 'esnext',
  },
});
