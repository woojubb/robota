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
  resolve: {
    alias: {
      // Contained — INFRA-158. The protocol package publishes one `.` entry and it is a NODE
      // bundle: its barrel re-exports the two modules that import `node:crypto`, so a browser
      // consumer of the transport GUI client pulls a Node builtin into this bundle and the build
      // fails on `randomBytes` rather than on the import that asked for it. The package already
      // carries a browser-safe barrel; this alias points the SPA at it.
      //
      // This is the containment, not the fix. Naming the browser entry in the package's own
      // `exports` map is a published-contract change, which is a direct-owner decision
      // (`backlog-execution.md` § "Never inside any class", item 2), so INFRA-158 carries it and
      // every consumer OUTSIDE this repository still receives the Node bundle until it lands.
      '@robota-sdk/agent-transport-protocol': new URL(
        '../agent-transport-protocol/src/browser.ts',
        import.meta.url,
      ).pathname,
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // The renderer runs in recent browsers only — no legacy down-transpile.
    target: 'esnext',
  },
});
