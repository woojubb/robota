import { builtinModules } from 'node:module';

import { defineConfig } from 'tsdown';

export default defineConfig({
  // The /local entry is Node-only. It may import the main entry's modules, never the reverse,
  // so no chunk the main entry loads reaches node:fs.
  entry: ['src/index.ts', 'src/local/index.ts'],
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
  deps: { neverBundle: [/^node:/, ...builtinModules] },
});
