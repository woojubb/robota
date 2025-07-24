import { defineConfig } from 'tsup';

// Shared configuration
const baseConfig = {
    dts: false, // Disable dts generation for now
    splitting: false,
    sourcemap: true, // Enable sourcemap for debugging
    clean: true,
    treeshake: true,
    minify: false, // Disable minify for development server
};

export default defineConfig([
    // Main application build
    {
        ...baseConfig,
        entry: ['src/index.ts', 'src/server.ts', 'src/app.ts'],
        outDir: 'dist',
        format: ['cjs'],
        platform: 'node',
        external: [
            // External dependencies that should not be bundled
            /^@robota-sdk\/.*/,  // All @robota-sdk packages
            'express',
            'cors',
            'helmet',
            'express-rate-limit',
            'ws'
        ],
    }
]); 