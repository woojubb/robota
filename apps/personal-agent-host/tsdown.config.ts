import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { main: 'src/main.ts' },
  format: ['esm'],
  outDir: 'dist',
  platform: 'node',
  sourcemap: false,
  dts: false,
  clean: true,
});
