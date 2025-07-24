import { defineConfig } from 'tsup';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

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
    minify: true,
};

export default defineConfig([
    // Node.js build (includes RemoteServer)
    {
        ...baseConfig,
        entry: ['src/server.ts'],
        outDir: 'dist/node',
        format: ['cjs'],
        platform: 'node',
        external: [
            // External dependencies that should not be bundled
            /^@robota-sdk\/.*/,  // All @robota-sdk packages
            'express',
            'cors',
            'helmet'
        ],
        outExtension() {
            return {
                js: '.js',
            };
        },
        onSuccess: async () => {
            // Create package.json for CommonJS
            mkdirSync('dist/node', { recursive: true });
            writeFileSync(
                join('dist/node/package.json'),
                JSON.stringify({ type: 'commonjs' }, null, 2)
            );
        },
    },
    // Browser build (no Node.js dependencies)
    {
        ...baseConfig,
        entry: ['src/browser.ts'],
        outDir: 'dist/browser',
        format: ['esm'],
        platform: 'browser',
        external: [
            // External dependencies that should not be bundled
            /^@robota-sdk\/.*/,  // All @robota-sdk packages
            // Note: express, cors, helmet removed for browser build as they're Node.js specific
        ],
        outExtension() {
            return {
                js: '.js',
            };
        },
        onSuccess: async () => {
            // Create package.json for ESM
            mkdirSync('dist/browser', { recursive: true });
            writeFileSync(
                join('dist/browser/package.json'),
                JSON.stringify({ type: 'module' }, null, 2)
            );
        },
        define: {
            'process.env.NODE_ENV': '"production"',
        },
        esbuildOptions(options) {
            // Additional browser optimizations
            options.drop = ['console', 'debugger'];
            options.dropLabels = ['DEV'];
        },
    }
]); 