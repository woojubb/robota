import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@robota-sdk/dag-core': fileURLToPath(
        new URL('../../dag-core/src/index.ts', import.meta.url),
      ),
      '@robota-sdk/dag-node': fileURLToPath(
        new URL('../../dag-node/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
  },
});
