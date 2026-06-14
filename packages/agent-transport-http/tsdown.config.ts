import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  outDir: 'dist/node',
  platform: 'node',
  clean: true,
  dts: true,
  sourcemap: false,
  treeshake: true,
  minify: true,
  outExtensions: ({ format }) => ({ js: format === 'cjs' ? '.cjs' : '.js', dts: '.d.ts' }),
  deps: { neverBundle: [/^@robota-sdk\/.*/, /^hono/] },
});
