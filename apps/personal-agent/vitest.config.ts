import { defineConfig, mergeConfig } from 'vitest/config';

import { resourceCeiling } from '../../vitest.shared';

// The app runs on the workspace SDK sources (the `source` export condition), so tests need no
// prior build of every SDK package.
export default mergeConfig(
  resourceCeiling,
  defineConfig({
    resolve: { conditions: ['source'] },
    ssr: { resolve: { conditions: ['source'], externalConditions: ['source'] } },
    test: {
      globals: true,
      environment: 'node',
      include: ['src/**/*.test.ts'],
      exclude: ['node_modules', 'dist'],
      testTimeout: 60_000,
      pool: 'forks',
      fileParallelism: false,
      server: { deps: { inline: [/@robota-sdk\//] } },
    },
  }),
);
