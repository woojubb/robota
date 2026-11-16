import { fileURLToPath } from 'node:url';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The personal agent's web UI build. `base: './'` keeps every asset relative, because the page is
 * served under the access-code session path the local server picks at random.
 *
 * The built page carries a strict CSP: it may reach its own origin (the personal API beside it) and a
 * loopback WebSocket (the agent's session), nothing else.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "connect-src 'self' ws://127.0.0.1:* ws://localhost:*",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "frame-src 'self'",
].join('; ');

export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'personal-built-page-csp',
      apply: 'build',
      transformIndexHtml: () => [
        { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY }, injectTo: 'head-prepend' },
      ],
    },
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'esnext',
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        // The push worker is a script of its own at the root of the build, beside the index, under a name
        // the page knows: served from the page's random path, its scope is exactly that path.
        'push-worker': fileURLToPath(new URL('./src/push-worker.ts', import.meta.url)),
      },
      output: {
        entryFileNames: (chunk) =>
          chunk.name === 'push-worker' ? 'push-worker.js' : 'assets/[name]-[hash].js',
      },
    },
    assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf)$/u.test(file) ? false : undefined),
  },
  optimizeDeps: { esbuildOptions: { target: 'esnext' } },
});
