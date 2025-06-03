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
    minify: false,
    target: 'node18',
    external: ['@robota-sdk/core', '@robota-sdk/tools', 'uuid'],
    outExtension({ format }) {
        return {
            js: format === 'cjs' ? '.js' : '.mjs'
        };
    },
    esbuildOptions(options) {
        options.conditions = ['module', 'import', 'require'];
    }
}); 