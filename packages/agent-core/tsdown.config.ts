import { defineConfig } from 'tsdown';

const outExtensions = ({ format }: { format: string }) => ({
  js: format === 'cjs' ? '.cjs' : '.js',
  dts: '.d.ts',
});

const shared = {
  sourcemap: false,
  treeshake: true,
  minify: true,
  dts: true,
  outExtensions,
  deps: { neverBundle: [/^@robota-sdk\/.*/] },
};

export default defineConfig([
  {
    ...shared,
    // Node build also emits the test-only ./testing subpath (TEST-003 scripted-provider SSOT).
    entry: { index: 'src/index.ts', 'testing/index': 'src/testing/index.ts' },
    format: ['esm', 'cjs'],
    outDir: 'dist/node',
    platform: 'node',
    clean: true,
  },
  {
    ...shared,
    // Browser build excludes test-only fixtures.
    entry: ['src/index.ts'],
    format: ['esm'],
    outDir: 'dist/browser',
    platform: 'browser',
    define: { 'process.env.NODE_ENV': '"production"' },
  },
]);
