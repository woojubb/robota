import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    outDir: 'dist/node',
    platform: 'node',
    clean: true,
    dts: true,
    sourcemap: false,
    treeshake: true,
    minify: false,
    outExtensions: ({ format }) => ({
      js: format === 'cjs' ? '.js' : '.mjs',
      dts: '.d.ts',
    }),
    deps: { neverBundle: [/^@robota-sdk\/.*/] },
  },
  {
    entry: ['src/index.ts'],
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
