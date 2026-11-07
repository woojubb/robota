import { builtinModules } from 'node:module';

import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { index: 'src/index.ts', node: 'src/node.ts' },
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
    neverBundle: [/^@robota-sdk\/.*/, /^node:/, /^koffi$/, ...builtinModules],
  },
});
