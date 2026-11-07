import { builtinModules } from 'node:module';

import { defineConfig } from 'tsdown';

// One build serves every runtime: the neutral entry runs unchanged in a browser, a Worker, Node, Deno and
// Bun. `node` and `testing` are Node-only subpaths that share its chunks, so one class has one identity
// whichever entry a consumer imports it from.
export default defineConfig({
  entry: { index: 'src/index.ts', node: 'src/node.ts', 'testing/index': 'src/testing/index.ts' },
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
