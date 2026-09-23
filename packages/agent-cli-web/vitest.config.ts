import { defineConfig, mergeConfig } from 'vitest/config';

import { resourceCeiling } from '../../vitest.shared';

/**
 * Issue #2167: the entry composition's contracts (WS URL selection, root admission, error-boundary
 * state) are pure functions and a static method, so they run under node — no DOM emulation needed.
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
