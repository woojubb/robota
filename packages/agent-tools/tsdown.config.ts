import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    // Each format ships its own declarations: .d.ts for import, .d.cts for require.
    format: { esm: {}, cjs: {} },
    outDir: 'dist/node',
    platform: 'node',
    clean: true,
    dts: true,
    sourcemap: false,
    treeshake: true,
    outExtensions: ({ format }) => ({
      js: format === 'cjs' ? '.cjs' : '.js',
      dts: format === 'cjs' ? '.d.cts' : '.d.ts',
    }),
    deps: { neverBundle: [/^@robota-sdk\/.*/] },
  },
  {
    entry: { browser: 'src/browser.ts' },
    format: ['esm'],
    outDir: 'dist/browser',
    platform: 'browser',
    dts: true,
    sourcemap: false,
    treeshake: true,
    minify: true,
    outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
    deps: { neverBundle: [/^@robota-sdk\/.*/] },
    define: { 'process.env.NODE_ENV': '"production"' },
  },
]);
