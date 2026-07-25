import { defineConfig } from 'vitest/config';

export default defineConfig({
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
    // Parallel execution
    threads: true,
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
});
