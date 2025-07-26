import { defineConfig } from 'tsup';

// Shared configuration
const baseConfig = {
    dts: {
        resolve: true,
        compilerOptions: {
            composite: false,
            stripInternal: true, // Remove @internal declarations and their comments
        }
    },
    splitting: false,
    sourcemap: false, // Disable sourcemap for smaller bundle size
    clean: true,
    treeshake: true,
    minify: true, // Enable minification for smaller bundle size
    publicDir: 'src/templates', // Copy templates directory to dist
};

export default defineConfig([
    // Node.js build
    {
        ...baseConfig,
        entry: ['src/index.ts'],
        outDir: 'dist/node',
        format: ['esm', 'cjs'],
        platform: 'node',
        external: [
            // External dependencies that should not be bundled
            /^@robota-sdk\/.*/,  // All @robota-sdk packages (for peer dependencies)
            'zod',
            '@dqbd/tiktoken'
        ],
    },
    // Browser build
    {
        ...baseConfig,
        entry: ['src/index.ts'],
        outDir: 'dist/browser',
        format: ['esm'],
        platform: 'browser',
        external: [
            // External dependencies that should not be bundled
            /^@robota-sdk\/.*/,  // All @robota-sdk packages (for peer dependencies)
            'zod'
            // Note: @dqbd/tiktoken removed for browser build as it's Node.js specific
        ],
        define: {
            // Define browser-specific globals if needed
            'process.env.NODE_ENV': '"production"',
        },
        esbuildOptions(options) {
            // Additional browser optimizations (console.log preserved for debugging)
            options.drop = ['debugger'];
            options.dropLabels = ['DEV'];
        },
    }
]); 