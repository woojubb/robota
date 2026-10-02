import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/** The shell's own logic (sidecar spawn, supervision) runs under node; the page is tested in agent-gui-web. */
export default defineConfig({
  resolve: {
    alias: [
      { find: '@robota-sdk/product-config/node', replacement: fileURLToPath(new URL('../../packages/product-config/src/node.ts', import.meta.url)) },
      { find: '@robota-sdk/product-config', replacement: fileURLToPath(new URL('../../packages/product-config/src/index.ts', import.meta.url)) },
    ],
  },
  test: {
    include: ['electron/**/*.test.ts', 'e2e/**/*.test.mjs'],
    environment: 'node',
  },
});
