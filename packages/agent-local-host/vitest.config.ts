import { defineConfig, mergeConfig } from 'vitest/config';

import { resourceCeiling } from '../../vitest.shared';

export default mergeConfig(
  resourceCeiling,
  defineConfig({
    test: {
      globals: true,
      environment: 'node',
      include: ['src/**/*.{test,spec}.ts'],
      exclude: ['node_modules', 'dist'],
      // scrypt at the default cost takes ~160 ms per unlock; a loaded CI runner needs headroom.
      testTimeout: 30_000,
      pool: 'forks',
      fileParallelism: false,
    },
  }),
);
