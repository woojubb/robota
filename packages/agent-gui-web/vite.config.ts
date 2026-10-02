import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { robotaEnvironment } from '../../products/robota.mjs';

import {
  parsePublicProductConfig,
  productConfigEntries,
  publicProductConfig,
} from '@robota-sdk/product-config';
import { loadProductConfig } from '@robota-sdk/product-config/node';
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

function selectedPublicProductConfig() {
  // The product generator writes both files in one fixed workspace location. Resolve from
  // the imported package, since Vite evaluates bundled configs under node_modules/.vite-temp.
  const packageFile = fileURLToPath(import.meta.resolve('@robota-sdk/product-config/package.json'));
  const productDirectory = resolve(dirname(packageFile), '..', '..', '.product');
  const publicFile = resolve(productDirectory, 'public-config.json');
  const identityFile = resolve(productDirectory, 'identity.json');
  const hasPublic = existsSync(publicFile);
  const hasIdentity = existsSync(identityFile);
  if (hasPublic !== hasIdentity)
    throw new Error(
      'Generated product identity and public configuration must be present together.',
    );
  if (!hasPublic)
    return publicProductConfig(
      loadProductConfig({
        environment: robotaEnvironment({ ...process.env }, process.env.HOME ?? homedir()),
      }),
    );

  const product = parsePublicProductConfig(JSON.parse(readFileSync(publicFile, 'utf8')));
  const projected = product as unknown as Record<string, Record<string, unknown>>;
  const embedded = JSON.parse(readFileSync(identityFile, 'utf8')) as Record<
    string,
    Record<string, unknown>
  >;
  for (const { section, field, descriptor } of productConfigEntries()) {
    if (descriptor.phase !== 'identity' || descriptor.exposure !== 'public') continue;
    if (
      JSON.stringify(projected[section]?.[field]) !== JSON.stringify(embedded[section]?.[field])
    ) {
      throw new Error('Generated public configuration conflicts with embedded product identity.');
    }
  }
  return product;
}

export default defineConfig(({ command }) => {
  const product = selectedPublicProductConfig();
  return {
    define: { __PRODUCT_PUBLIC_CONFIG__: JSON.stringify(product) },
    base: './',
    // The dev server reads workspace packages from their TypeScript source (`source` export condition), so
    // `pnpm gui:dev` hot-reloads edits to them too and needs no build; `vite build` keeps using their `dist`.
    resolve: {
      conditions:
        command === 'serve' ? ['source', ...defaultClientConditions] : [...defaultClientConditions],
    },
    plugins: [
      {
        name: 'product-page-title',
        transformIndexHtml: (html) =>
          html.replace(
            '<title></title>',
            `<title>${product.identity.displayName.replace(/[&<>"']/g, (value) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[value]!)}</title>`,
          ),
      },
      react(),
      tailwindcss(),
      {
        name: 'agent-built-page-csp',
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
      // Fonts stay files: the page's CSP loads fonts from 'self' only, and a `data:` URI is not 'self'.
      assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf)$/u.test(file) ? false : undefined),
    },
    // The dev server pre-bundles dependencies too; the same target keeps it from down-transpiling them.
    optimizeDeps: { esbuildOptions: { target: 'esnext' } },
  };
});
