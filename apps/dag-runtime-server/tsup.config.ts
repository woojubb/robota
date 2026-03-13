import { defineConfig } from 'tsup';

export default defineConfig([
    {
        entry: ['src/server.ts'],
        outDir: 'dist',
        format: ['cjs'],
        platform: 'node',
        dts: false,
        splitting: false,
        sourcemap: true,
        clean: true,
        treeshake: true,
        minify: false,
        external: [
            /^@robota-sdk\/.*/,
            'express'
        ],
    }
]);
