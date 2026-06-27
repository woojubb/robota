import { defineConfig } from 'tsdown';

export default defineConfig({
  // The ./testing subpath ships the functional test harness (TEST-003), kept out of the main entry.
  entry: { index: 'src/index.ts', 'testing/index': 'src/testing/index.ts' },
  format: ['esm', 'cjs'],
  outDir: 'dist/node',
  platform: 'node',
  clean: true,
  dts: true,
  sourcemap: false,
  treeshake: true,
  minify: true,
  outExtensions: ({ format }) => ({
    js: format === 'cjs' ? '.cjs' : '.js',
    dts: '.d.ts',
  }),
  deps: {
    neverBundle: [/^@robota-sdk\/.*/],
  },
});
