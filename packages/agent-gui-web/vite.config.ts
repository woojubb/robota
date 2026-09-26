import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defaultClientConditions, defineConfig } from 'vite';

/**
 * The GUI web app build. One static entry for every host: the desktop app loads `dist/` from disk
 * (`base: './'` so a `file://` load resolves assets), and `agent-cli` copies `dist/` into its own
 * `dist/web` and serves it over localhost HTTP.
 *
 * The built page carries a strict CSP: it may reach only a loopback WebSocket (its sidecar). The dev
 * server goes without it, because Vite injects an inline HMR preamble the policy would block. The
 * desktop app additionally pins the exact port through a response header.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  'connect-src ws://127.0.0.1:* ws://localhost:*',
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
].join('; ');

export default defineConfig(({ command }) => ({
  base: './',
  // The dev server reads workspace packages from their TypeScript source (`source` export condition), so
  // `pnpm gui:dev` hot-reloads edits to them too and needs no build; `vite build` keeps using their `dist`.
  resolve: {
    conditions:
      command === 'serve' ? ['source', ...defaultClientConditions] : [...defaultClientConditions],
  },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'robota-built-page-csp',
      apply: 'build',
      transformIndexHtml: () => [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY },
          injectTo: 'head-prepend',
        },
      ],
    },
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Recent browsers and Electron's bundled Chromium only — no legacy down-transpile.
    target: 'esnext',
  },
  // The dev server pre-bundles dependencies too; the same target keeps it from down-transpiling them.
  optimizeDeps: { esbuildOptions: { target: 'esnext' } },
}));
