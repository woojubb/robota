import { builtinModules } from 'node:module';

import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    // One build for every runtime. The Node-only `./node` entry is built in the same pass so it shares
    // the neutral entry's chunks.
    entry: { index: 'src/index.ts', node: 'src/node.ts' },
    // Each format ships its own declarations: .d.ts for import, .d.cts for require.
    format: { esm: {}, cjs: {} },
    outDir: 'dist',
    platform: 'neutral',
    clean: true,
    dts: true,
    sourcemap: false,
    treeshake: true,
    outExtensions: ({ format }) => ({
      js: format === 'cjs' ? '.cjs' : '.js',
      dts: format === 'cjs' ? '.d.cts' : '.d.ts',
    }),
    deps: { neverBundle: [/^@robota-sdk\/.*/, /^node:/, ...builtinModules] },
  },
]);
