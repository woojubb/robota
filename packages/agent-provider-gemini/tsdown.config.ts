import { defineConfig } from 'tsdown';

const outExtensions = ({ format }: { format: string }) => ({
  js: format === 'cjs' ? '.cjs' : '.js',
  dts: '.d.ts',
});

const shared = {
  format: ['esm', 'cjs'] as const,
  outDir: 'dist/node',
  platform: 'node' as const,
  clean: true,
  dts: true,
  sourcemap: false,
  treeshake: true,
  minify: true,
  outExtensions,
  deps: { neverBundle: [/^@robota-sdk\/.*/] },
};

export default defineConfig({
  ...shared,
  entry: {
    index: 'src/index.ts',
    'google/index': 'src/google.ts',
  },
});
