import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['cjs', 'esm'],
    dts: {
        resolve: true,
        compilerOptions: {
            composite: false
        }
    },
    splitting: false,
    sourcemap: false, // Disable sourcemap for smaller bundle size
    clean: true,
    treeshake: true,
    external: [
        // External dependencies that should not be bundled
        /^@robota-sdk\/.*/,  // All @robota-sdk packages
        '@google/generative-ai'
    ],
}); 