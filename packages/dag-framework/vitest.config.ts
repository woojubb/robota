import { defineConfig, mergeConfig } from 'vitest/config';

import { resourceCeiling } from '../../vitest.shared';

export default mergeConfig(
  resourceCeiling,
  defineConfig({
    test: {
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      environment: 'node',
      testTimeout: 15000,
      coverage: {
        provider: 'v8',
        include: ['src/**/*.ts'],
        exclude: ['src/__tests__/**', '**/*.config.ts', '**/tsdown.config.ts'],
      },
    },
  }),
);
