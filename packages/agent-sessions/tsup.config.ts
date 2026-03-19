import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist/node',
  format: ['esm', 'cjs'],
  dts: {
    compilerOptions: {
      composite: false,
    },
  },
  splitting: false,
  sourcemap: false,
  clean: true,
  treeshake: true,
  target: 'node18',
  platform: 'node',
  skipNodeModulesBundle: true,
  external: [/^@robota-sdk\/.*/],
});
