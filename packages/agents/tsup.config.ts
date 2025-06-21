import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: {
        resolve: true,
        compilerOptions: {
            composite: false
        }
    },
    splitting: false,
    sourcemap: true,
    clean: true,
    treeshake: true,
    publicDir: 'src/templates', // Copy templates directory to dist
    external: [
        // External dependencies that should not be bundled
        /^@robota-sdk\/.*/,  // All @robota-sdk packages (for peer dependencies)
        'zod',
        '@dqbd/tiktoken'
    ],
}); 