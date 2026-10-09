import { defineConfig, mergeConfig } from 'vitest/config';
import { resourceCeiling } from '../../vitest.shared';

export default mergeConfig(resourceCeiling, defineConfig({
  test: {
    include: ['src/**/*.{test,spec}.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 30_000,
    pool: 'forks',
    fileParallelism: false,
  },
}));
