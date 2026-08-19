import { defineConfig, mergeConfig } from 'vitest/config';

import { resourceCeiling } from '../../vitest.shared';

export default mergeConfig(
  resourceCeiling,
  defineConfig({
    test: {
      include: ['src/**/*.{test,spec}.{ts,tsx}', 'tests/**/*.{test,spec}.{ts,tsx}'],
      environment: 'node',
      testTimeout: 10000,
      globals: true,
      coverage: {
        exclude: ['examples/**', 'src/**/*.test.ts', 'src/**/*.spec.ts', 'tests/**'],
      },
    },
  }),
);
