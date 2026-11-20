import { defineConfig, mergeConfig } from 'vitest/config';

import { resourceCeiling } from '../../vitest.shared';

export default mergeConfig(
  resourceCeiling,
  defineConfig({
    test: {
      environment: 'node',
      globals: true,
      ...(process.platform === 'win32' ? { testTimeout: 20_000 } : {}),
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html'],
        exclude: ['dist/**', 'node_modules/**', 'examples/**', '**/*.test.ts', '**/*.spec.ts'],
      },
    },
  }),
);
