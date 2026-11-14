import { defineConfig } from 'vitest/config';

/**
 * Dedicated PTY project: real-terminal TUI suites against the built
 * CLI binary. Excluded from the default test run (`*.ptytest.ts` is outside the
 * default include); run via `pnpm --filter @robota-sdk/agent-ui-terminal test:pty`
 * after building @robota-sdk/agent-cli. The workspace packages a suite imports for its own
 * assertions resolve from source, so that one build is all the project needs.
 */
export default defineConfig({
  ssr: { resolve: { conditions: ['source'] } },
  test: {
    include: ['src/**/*.ptytest.ts'],
    testTimeout: 60_000,
    hookTimeout: 30_000,
    pool: 'forks',
    fileParallelism: false,
  },
});
