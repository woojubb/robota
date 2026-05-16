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
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    outDir: 'dist/node',
    platform: 'node',
    clean: true,
  },
  {
    ...shared,
    entry: {
      file: 'src/loggers/file.ts',
      console: 'src/loggers/console.ts',
    },
    format: ['esm', 'cjs'],
    outDir: 'dist/loggers',
    platform: 'node',
    clean: true,
  },
  {
    ...shared,
    entry: ['src/index.ts'],
    format: ['esm'],
    outDir: 'dist/browser',
    platform: 'browser',
    outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
    define: { 'process.env.NODE_ENV': '"production"' },
  },
]);
