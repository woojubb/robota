import { defineConfig, mergeConfig } from 'vitest/config';

import { resourceCeiling } from '../../vitest.shared';

/**
 * The entry's contracts (host resolution, WS URL selection, root admission, error-boundary state) run
 * under node; a suite that renders components opts into jsdom with a `@vitest-environment` docblock.
 */
export default mergeConfig(
  resourceCeiling,
  defineConfig({
    test: {
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      environment: 'node',
    },
  }),
);
