import { defineConfig } from 'vitest/config';

/**
 * Dedicated PTY project (CLI-074): real-terminal TUI suites against the built
 * CLI binary. Excluded from the default test run (`*.ptytest.ts` is outside the
 * default include); run via `pnpm --filter @robota-sdk/agent-transport test:pty`
 * after building @robota-sdk/agent-cli.
 */
export default defineConfig({
  test: {
    include: ['src/**/*.ptytest.ts'],
    testTimeout: 60_000,
    hookTimeout: 30_000,
    pool: 'forks',
    fileParallelism: false,
  },
});
