import { defineConfig, mergeConfig } from 'vitest/config';

import { resourceCeiling } from '../../vitest.shared';

export default mergeConfig(
  resourceCeiling,
  defineConfig({
    test: {
      environment: 'node',
      testTimeout: 10_000,
      server: { deps: { inline: [/@robota-sdk\/workflows/] } },
      globals: true,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html'],
        exclude: ['dist/**', 'node_modules/**', 'examples/**', '**/*.test.ts', '**/*.spec.ts'],
      },
    },
  }),
);
