import { builtinModules } from 'node:module';

import { defineConfig } from 'tsdown';

export default defineConfig({
  // One build for every runtime: the main entry is platform-neutral, and the Node-only `./node` and
  // `./testing` entries are built in the same pass so they share its chunks (one class, one identity).
  // The ./testing subpath ships the functional test harness, kept out of the main entry;
  // ./node is what only a Node host provides.
  entry: { index: 'src/index.ts', node: 'src/node.ts', 'testing/index': 'src/testing/index.ts' },
  format: { esm: {}, cjs: {} },
  outDir: 'dist',
  platform: 'neutral',
  clean: true,
  dts: true,
  sourcemap: false,
  treeshake: true,
  minify: true,
  outExtensions: ({ format }) => ({
    js: format === 'cjs' ? '.cjs' : '.js',
    dts: format === 'cjs' ? '.d.cts' : '.d.ts',
  }),
  deps: {
    neverBundle: [/^@robota-sdk\/.*/, /^node:/, ...builtinModules],
  },
});
