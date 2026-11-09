import { defineConfig, mergeConfig } from 'vitest/config';

import { resourceCeiling } from '../../vitest.shared';

/**
 * The kill and lock tests spawn real child processes (some SIGTERM-ignoring) and the file
 * authority tests share native directory handles, so they need a longer timeout and
 * process-forked isolation without file parallelism.
 */
export default mergeConfig(
  resourceCeiling,
  defineConfig({
    test: {
      globals: true,
      environment: 'node',
      include: ['src/**/*.{test,spec}.ts'],
      exclude: ['node_modules', 'dist'],
      testTimeout: 30_000,
      hookTimeout: 30_000,
      pool: 'forks',
      fileParallelism: false,
    },
  }),
);
