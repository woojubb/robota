import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['cjs', 'esm'],
    dts: true,
    clean: true,
    sourcemap: true,
    minify: false,
    target: 'node18',
    external: ['@robota-sdk/agents'],
    treeshake: true,
    splitting: false,
    bundle: true,
    outDir: 'dist'
}); 