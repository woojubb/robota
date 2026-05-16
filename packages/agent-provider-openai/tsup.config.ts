import { defineConfig } from 'tsup';

// Shared configuration
const baseConfig = {
  dts: {
    resolve: true,
    compilerOptions: {
      composite: false,
    },
  },
  splitting: false,
  sourcemap: false, // Disable sourcemap for smaller bundle size
  clean: true,
  treeshake: true,
  minify: true,
};

const nodeExternal = [/^@robota-sdk\/.*/, 'openai'];

export default defineConfig([
  // Node.js build
  {
    ...baseConfig,
    entry: ['src/index.ts'],
    outDir: 'dist/node',
    format: ['esm', 'cjs'],
    platform: 'node',
    external: nodeExternal,
  },
  // Loggers sub-path build (./loggers/file, ./loggers/console)
  {
    ...baseConfig,
    entry: {
      file: 'src/loggers/file.ts',
      console: 'src/loggers/console.ts',
    },
    outDir: 'dist/loggers',
    format: ['esm', 'cjs'],
    platform: 'node',
    external: nodeExternal,
  },
  // Browser build
  {
    ...baseConfig,
    entry: ['src/index.ts'],
    outDir: 'dist/browser',
    format: ['esm'],
    platform: 'browser',
    external: nodeExternal,
    define: {
      'process.env.NODE_ENV': '"production"',
    },
    esbuildOptions(options) {
      options.drop = ['console', 'debugger'];
      options.dropLabels = ['DEV'];
    },
  },
]);
