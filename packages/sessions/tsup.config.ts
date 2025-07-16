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
    sourcemap: false, // Disable sourcemap for smaller bundle size
    clean: true,
    treeshake: true,
    minify: false,
    target: 'node18',
    external: [
        // External dependencies that should not be bundled
        /^@robota-sdk\/.*/,  // All @robota-sdk packages
        'uuid'
    ],
    skipNodeModulesBundle: true,
    outExtension({ format }) {
        return {
            js: format === 'cjs' ? '.js' : '.mjs'
        };
    },
    esbuildOptions(options) {
        options.conditions = ['module', 'import', 'require'];
    }
}); 