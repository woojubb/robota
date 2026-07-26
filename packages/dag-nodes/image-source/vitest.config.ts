import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vitest/config';

import { resourceCeiling } from '../../../vitest.shared';

export default mergeConfig(
  resourceCeiling,
  defineConfig({
    resolve: {
      alias: {
        '@robota-sdk/dag-core': fileURLToPath(
          new URL('../../dag-core/src/index.ts', import.meta.url),
        ),
        '@robota-sdk/dag-node': fileURLToPath(
          new URL('../../dag-node/src/index.ts', import.meta.url),
        ),
      },
    },
    test: {
      environment: 'node',
    },
  }),
);
