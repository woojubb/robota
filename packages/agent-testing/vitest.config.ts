import { defineConfig, mergeConfig } from 'vitest/config';

import { resourceCeiling } from '../../vitest.shared';

/**
 * The PTY self-test spawns real pseudo-terminals, so it needs a longer timeout and process-forked
 * isolation (matching the consumer PTY suites in agent-transport-tui).
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
