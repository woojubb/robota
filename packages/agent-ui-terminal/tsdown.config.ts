import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  // ESM only: ink loads yoga-layout, whose entry has a top-level await, so a CommonJS build could
  // never be require()d (ERR_REQUIRE_ASYNC_MODULE). package.json exports no `require` condition.
  format: ['esm'],
  outDir: 'dist/node',
  platform: 'node',
  clean: true,
  dts: true,
  sourcemap: false,
  treeshake: true,
  minify: true,
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  deps: {
    neverBundle: [/^@robota-sdk\/.*/, /^ink/, /^react/, /^chalk$/, /^marked/, /^string-width$/],
  },
});
