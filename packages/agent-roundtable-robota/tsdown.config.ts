import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: { esm: {}, cjs: {} },
  outDir: 'dist',
  platform: 'node',
  clean: true,
  dts: true,
  outExtensions: ({ format }) => ({
    js: format === 'cjs' ? '.cjs' : '.js',
    dts: format === 'cjs' ? '.d.cts' : '.d.ts',
  }),
  deps: {
    neverBundle: [/^@robota-sdk\//],
  },
});
