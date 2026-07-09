import { defineConfig } from 'tsdown';

const outExtensions = ({ format }: { format: string }) => ({
  js: format === 'cjs' ? '.cjs' : '.js',
  dts: '.d.ts',
});

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['esm', 'cjs'],
  outDir: 'dist/node',
  platform: 'node',
  sourcemap: false,
  treeshake: true,
  minify: true,
  dts: true,
  outExtensions,
  clean: true,
});
