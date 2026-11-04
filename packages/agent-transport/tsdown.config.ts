import { builtinModules } from 'node:module';

import { defineConfig } from 'tsdown';

// One build serves every runtime. `node` is the Node-only subpath; it shares the neutral entries' chunks.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    client: 'src/client.ts',
    node: 'src/node/index.ts',
  },
  format: { esm: {}, cjs: {} },
  outDir: 'dist',
  platform: 'neutral',
  clean: true,
  sourcemap: false,
  treeshake: true,
  minify: true,
  dts: true,
  outExtensions: ({ format }) => ({
    js: format === 'cjs' ? '.cjs' : '.js',
    dts: format === 'cjs' ? '.d.cts' : '.d.ts',
  }),
  deps: { neverBundle: [/^@robota-sdk\/.*/, /^node:/, ...builtinModules] },
});
