import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    splitting: false,
    sourcemap: true,
    clean: true,
    treeshake: true,
    minify: false,
    target: 'node18',
    external: ['zod'],
    tsconfig: './tsconfig.json',
    outExtension({ format }) {
        return {
            js: format === 'cjs' ? '.js' : '.mjs'
        };
    },
    esbuildOptions(options) {
        options.conditions = ['module', 'import', 'require'];
    }
}); 