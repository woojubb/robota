import { defineConfig, mergeConfig } from 'vitest/config';

import { resourceCeiling } from '../../vitest.shared';

export default mergeConfig(
  resourceCeiling,
  defineConfig({
    test: {
      environment: 'node',
      include: ['src/**/*.test.{ts,tsx}'],
    },
    esbuild: { jsx: 'automatic' },
    resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
  }),
);
