import { defineConfig, mergeConfig } from 'vitest/config';

import { resourceCeiling } from '../../vitest.shared';

/**
 * The kill tests spawn real child processes (some SIGTERM-ignoring), so they need a longer
 * timeout and process-forked isolation.
 */
export default mergeConfig(
  resourceCeiling,
  defineConfig({
    test: {
      include: ['src/**/*.{test,spec}.ts'],
      environment: 'node',
      testTimeout: 30_000,
      hookTimeout: 30_000,
      pool: 'forks',
      fileParallelism: false,
      globals: true,
    },
  }),
);
