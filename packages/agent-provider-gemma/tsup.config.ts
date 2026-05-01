import { defineConfig } from 'tsup';

const baseConfig = {
  dts: {
    resolve: true,
    compilerOptions: {
      composite: false,
    },
  },
  splitting: false,
  sourcemap: false,
  clean: true,
  treeshake: true,
  minify: true,
};

export default defineConfig([
  {
    ...baseConfig,
    entry: ['src/index.ts'],
    outDir: 'dist/node',
    format: ['esm', 'cjs'],
    platform: 'node',
    external: [/^@robota-sdk\/.*/, 'openai'],
  },
  {
    ...baseConfig,
    entry: ['src/index.ts'],
    outDir: 'dist/browser',
    format: ['esm'],
    platform: 'browser',
    external: [/^@robota-sdk\/.*/, 'openai'],
    define: {
      'process.env.NODE_ENV': '"production"',
    },
    esbuildOptions(options) {
      options.drop = ['console', 'debugger'];
      options.dropLabels = ['DEV'];
    },
  },
]);
