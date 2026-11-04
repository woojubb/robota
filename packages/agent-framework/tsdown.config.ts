import { defineConfig } from 'tsdown';

export default defineConfig({
  // The ./testing subpath ships the functional test harness (TEST-003), kept out of the main entry;
  // ./node is what only a Node host provides.
  entry: { index: 'src/index.ts', node: 'src/node.ts', 'testing/index': 'src/testing/index.ts' },
  format: { esm: {}, cjs: {} },
  outDir: 'dist/node',
  platform: 'node',
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
    neverBundle: [/^@robota-sdk\/.*/],
  },
});
