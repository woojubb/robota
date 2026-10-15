import { defineConfig, mergeConfig } from 'vitest/config';

import { resourceCeiling } from '../../vitest.shared';

export default mergeConfig(
  resourceCeiling,
  defineConfig({
    resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
    esbuild: { jsx: 'automatic' },
    test: {
      environment: 'node',
      include: ['src/**/*.test.{ts,tsx}'],
    },
  }),
);
