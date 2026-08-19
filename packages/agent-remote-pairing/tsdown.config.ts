import { defineConfig } from 'tsdown';

export default defineConfig({
  // SEC-010: the /local entry is node-only and is built separately so the main entry stays
  // isomorphic — a browser bundle must not pull node:fs in through a shared chunk.
  entry: ['src/index.ts', 'src/local/index.ts'],
  format: ['esm', 'cjs'],
  outDir: 'dist/node',
  platform: 'neutral',
  clean: true,
  dts: true,
  sourcemap: false,
  treeshake: true,
  minify: true,
  outExtensions: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.js', dts: '.d.ts' }),
});
