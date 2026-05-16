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
  deps: {
    neverBundle: [/^@robota-sdk\/.*/, /^ink/, /^react/, /^chalk$/, /^marked/, /^string-width$/],
  },
};

export default defineConfig({
  ...shared,
  entry: {
    index: 'src/index.ts',
  },
  format: ['esm', 'cjs'],
  outDir: 'dist/node',
  platform: 'node',
  clean: true,
});
