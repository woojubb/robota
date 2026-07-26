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
    // Worker fan-out is CAPPED, not left to the default. `threads: true` stood here and had been a
    // no-op since vitest 1.0 removed the option — vitest 3 accepts it silently, so a setting that
    // looked like it configured parallelism configured nothing. The real default is
    // `availableParallelism() - 1`, which is 19 forks on a 20-core machine.
    //
    // That default is what made an OOM possible on 2026-07-26: `pnpm test` fans out recursively
    // (measured: 9 workspaces at once), and each workspace starts its OWN vitest that fans out
    // again. The product is unbounded. Measured over an identical 40s window: 84 concurrent test
    // processes holding 7.1 GB uncapped, versus 27 processes holding 1.9 GB capped.
    //
    // Bound the product instead of either factor alone: this cap pairs with
    // `workspace-concurrency` in .npmrc, so concurrent test processes stay near the core count
    // rather than its square. Per-worker memory is NOT the problem (104-181 MB measured across
    // all 796 files); process COUNT is.
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: Number(process.env['VITEST_MAX_FORKS'] ?? 4),
      },
    },
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
