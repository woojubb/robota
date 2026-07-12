import { resolve } from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * GUI-006 — the CLI-served web GUI build. Two static entries: the localhost monitor (`index.html` →
 * `SessionMonitor` from the GUI core) and the Stage-D browser remote client (`remote.html` → `RemoteClient`
 * from `agent-transport-webrtc-web`). `agent-cli` copies this app's `dist/` into `dist/web` and serves it.
 */
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // The renderer runs in recent browsers only — no legacy down-transpile.
    target: 'esnext',
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        remote: resolve(__dirname, 'remote.html'),
      },
    },
  },
});
