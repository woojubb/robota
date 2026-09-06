import { defineConfig } from 'tsdown';

const shared = {
  dts: true,
  sourcemap: false,
  treeshake: true,
  minify: true,
  outExtensions: ({ format }: { format: string }) => ({
    js: format === 'cjs' ? '.cjs' : '.js',
    dts: '.d.ts',
  }),
  deps: { neverBundle: [/^@robota-sdk\/.*/, /^ws$/] },
};

export default defineConfig([
  {
    ...shared,
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    outDir: 'dist/node',
    platform: 'node',
    clean: true,
  },
  {
    ...shared,
    entry: { client: 'src/client.ts' },
    format: ['esm'],
    outDir: 'dist/browser',
    platform: 'browser',
  },
]);
