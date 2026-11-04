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
]);
