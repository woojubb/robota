import { defineConfig } from 'vitest/config';

/**
 * Built-binary E2E project (INFRA-020): suites that spawn the real robota CLI binary
 * (`*.bintest.ts`). Excluded from the default test run (outside the default include); run via
 * `pnpm --filter @robota-sdk/agent-cli test:bin` after building @robota-sdk/agent-cli.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.bintest.ts'],
    environment: 'node',
    globals: true,
    testTimeout: 60_000,
    hookTimeout: 30_000,
    pool: 'forks',
    fileParallelism: false,
  },
});
