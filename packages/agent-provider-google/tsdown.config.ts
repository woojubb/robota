import { defineConfig } from 'tsdown';

const outExtensions = ({ format }: { format: string }) => ({
  js: format === 'cjs' ? '.cjs' : '.js',
  dts: '.d.ts',
});

const shared = {
  entry: ['src/index.ts'],
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
    format: ['esm', 'cjs'],
    outDir: 'dist/node',
    platform: 'node',
    clean: true,
  },
  {
    ...shared,
    format: ['esm'],
    outDir: 'dist/browser',
    platform: 'browser',
    define: { 'process.env.NODE_ENV': '"production"' },
  },
]);
