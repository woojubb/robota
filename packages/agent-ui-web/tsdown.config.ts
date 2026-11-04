import { defineConfig } from 'tsdown';

// One build serves every runtime that has a DOM: the Node build and the browser build of this package were
// byte-identical, and `./client` is the same file as `.`.
export default defineConfig({
  entry: ['src/index.ts'],
  format: { esm: {}, cjs: {} },
  outDir: 'dist',
  platform: 'neutral',
  clean: true,
  sourcemap: false,
  treeshake: true,
  dts: true,
  outExtensions: ({ format }) => ({
    js: format === 'cjs' ? '.cjs' : '.js',
    dts: format === 'cjs' ? '.d.cts' : '.d.ts',
  }),
  deps: { neverBundle: [/^@robota-sdk\/.*/] },
});
