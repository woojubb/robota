import { defineConfig, mergeConfig } from 'vitest/config';

import { resourceCeiling } from '../../vitest.shared';

/**
 * Most of this suite writes and reads durable files, which on a loaded Windows runner takes several
 * times as long as elsewhere: a slow run took 18 to 26 s for files that take a few seconds, and
 * unrelated cases timed out together at 10 s. Windows gets the bound the other file-heavy packages use.
 */
const FILE_TEST_TIMEOUT_MS = process.platform === 'win32' ? 30_000 : 10_000;

export default mergeConfig(
  resourceCeiling,
  defineConfig({
    test: {
      globals: true,
      environment: 'node',
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      exclude: ['node_modules', 'dist'],
      testTimeout: FILE_TEST_TIMEOUT_MS,
      hookTimeout: FILE_TEST_TIMEOUT_MS,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html'],
        exclude: [
          'node_modules',
          'dist',
          '**/*.d.ts',
          '**/*.config.ts',
          '**/index.ts',
          'examples/**',
        ],
      },
    },
  }),
);
