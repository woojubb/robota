import { defineConfig, mergeConfig } from 'vitest/config';

import { resourceCeiling } from './vitest.shared';

export default mergeConfig(
  resourceCeiling,
  defineConfig({
    test: {
      // New pattern: Place .test.ts or .spec.ts files next to source files
      include: [
        'packages/**/src/**/*.{test,spec}.{ts,tsx}',
        // Continue to support existing test directories
        'packages/**/tests/**/*.{test,spec}.{ts,tsx}',
        // Harness script tests
        'scripts/**/__tests__/**/*.test.{ts,mjs}',
      ],
      environment: 'node',
      // Worker fan-out and per-worker heap are bounded by `vitest.shared.ts`, merged above — the same
      // ceiling every package config inherits, so this path cannot drift from theirs. `threads: true`
      // stood here and had been a no-op since vitest 1.0 removed the option; vitest 3 accepts it
      // silently, so the line that looked like the parallelism setting configured nothing.
      // Timeout settings
      testTimeout: 10000,
      // Coverage settings
      coverage: {
        provider: 'v8',
        // 'lcov' (INFRA-041): machine-readable report for the PR patch-coverage gate
        // (scripts/harness/check-patch-coverage.mjs); per-package runs get it via CLI flags.
        reporter: ['text', 'json', 'html', 'lcov'],
        exclude: [
          'node_modules/',
          '**/dist/',
          '**/test/',
          '**/*.test.ts',
          '**/*.spec.ts',
          '**/*.d.ts',
        ],
      },
    },
  }),
);
