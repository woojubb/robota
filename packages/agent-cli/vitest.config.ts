import { defineConfig, mergeConfig } from 'vitest/config';

import { resourceCeiling } from '../../vitest.shared';

export default mergeConfig(
  resourceCeiling,
  defineConfig({
    test: {
      environment: 'node',
      // Ink needs the native Node console constructor when it patches terminal output.
      disableConsoleIntercept: true,
      testTimeout: 20_000,
      server: { deps: { inline: [/@robota-sdk\/workflows/] } },
      globals: true,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'json', 'html'],
        exclude: ['dist/**', 'node_modules/**', 'examples/**', '**/*.test.ts', '**/*.spec.ts'],
      },
    },
  }),
);
