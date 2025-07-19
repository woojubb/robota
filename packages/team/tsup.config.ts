import { defineConfig } from 'tsup';

// Shared configuration
const baseConfig = {
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
    target: 'node18',
    skipNodeModulesBundle: true,
};

export default defineConfig([
    // Node.js build
    {
        ...baseConfig,
        entry: ['src/index.ts'],
        outDir: 'dist/node',
        format: ['esm', 'cjs'],
        platform: 'node',
        minify: false,
        external: [
            // External dependencies that should not be bundled
            /^@robota-sdk\/.*/,  // All @robota-sdk packages
            'uuid'
        ],
        outExtension({ format }) {
            return {
                js: format === 'cjs' ? '.js' : '.mjs'
            };
        },
        esbuildOptions(options) {
            options.conditions = ['module', 'import', 'require'];
        }
    },
    // Browser build
    {
        ...baseConfig,
        entry: ['src/index.ts'],
        outDir: 'dist/browser',
        format: ['esm'],
        platform: 'browser',
        minify: true,
        external: [
            // External dependencies that should not be bundled
            /^@robota-sdk\/.*/,  // All @robota-sdk packages
            'uuid'
        ],
        define: {
            'process.env.NODE_ENV': '"production"',
        },
        esbuildOptions(options) {
            // Additional browser optimizations
            options.drop = ['console', 'debugger'];
            options.dropLabels = ['DEV'];
            options.conditions = ['module', 'import', 'browser'];
        },
    }
]); 