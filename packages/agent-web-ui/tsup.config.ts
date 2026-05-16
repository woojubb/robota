import { defineConfig } from 'tsup';

const baseConfig = {
  dts: {
    resolve: true,
    compilerOptions: {
      composite: false,
      stripInternal: true,
    },
  },
  splitting: false,
  sourcemap: false,
  clean: true,
  treeshake: true,
  entry: ['src/index.ts'],
  external: [/^@robota-sdk\/.*/, 'react', 'react-dom'],
};

export default defineConfig([
  {
    ...baseConfig,
    outDir: 'dist/node',
    format: ['esm', 'cjs'],
    platform: 'node',
  },
  {
    ...baseConfig,
    outDir: 'dist/browser',
    format: ['esm'],
    platform: 'browser',
    define: {
      'process.env.NODE_ENV': '"production"',
    },
  },
]);
