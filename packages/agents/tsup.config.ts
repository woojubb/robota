import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: {
        resolve: true,
        compilerOptions: {
            composite: false,
            stripInternal: true, // Remove @internal declarations and their comments
            // Keep JSDoc comments for IDE support, but optimize source comments
        }
    },
    splitting: false,
    sourcemap: false, // Disable sourcemap for smaller bundle size
    clean: true,
    treeshake: true,
    minify: true, // Enable minification for smaller bundle size
    publicDir: 'src/templates', // Copy templates directory to dist
    external: [
        // External dependencies that should not be bundled
        /^@robota-sdk\/.*/,  // All @robota-sdk packages (for peer dependencies)
        'zod',
        '@dqbd/tiktoken'
    ],
}); 