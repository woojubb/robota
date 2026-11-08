import { defineConfig } from 'tsdown';

// One entry per primitive: a consumer that imports `process` never reaches the native Koffi
// binding that `file-authority` and `node-lock` load. Koffi is an optional peer dependency and
// stays external.
export default defineConfig({
  entry: {
    'file-authority/index': 'src/file-authority/index.ts',
    'file-authority/testing/index': 'src/file-authority/testing/index.ts',
    'node-lock/index': 'src/node-lock/index.ts',
    'process/index': 'src/process/index.ts',
  },
  format: { esm: {}, cjs: {} },
  outDir: 'dist',
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
    neverBundle: [/^@robota-sdk\/.*/, /^koffi$/],
  },
});
