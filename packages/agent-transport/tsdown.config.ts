import { defineConfig } from 'tsdown';

const outExtensions = ({ format }: { format: string }) => ({
  js: format === 'cjs' ? '.cjs' : '.js',
  dts: '.d.ts',
});

export default defineConfig({
  sourcemap: false,
  treeshake: true,
  minify: true,
  dts: true,
  outExtensions,
  deps: {
    neverBundle: [/^@robota-sdk\/.*/],
  },
  entry: {
    index: 'src/index.ts',
    'headless/index': 'src/headless/index.ts',
    'testing/index': 'src/testing/index.ts',
  },
  format: ['esm', 'cjs'],
  outDir: 'dist/node',
  platform: 'node',
  clean: true,
});
