import { defineConfig } from 'tsup';

// Shared configuration
const baseConfig = {
  dts: {
    resolve: true,
    compilerOptions: {
      composite: false,
      stripInternal: true, // Remove @internal declarations and their comments
    },
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
    entry: ['src/index.ts', 'src/cli-tools/index.ts'],
    outDir: 'dist/node',
    format: ['esm', 'cjs'],
    platform: 'node',
    external: [
      // External dependencies that should not be bundled
      /^@robota-sdk\/.*/, // All @robota-sdk packages (for peer dependencies)
      'zod',
      'fast-glob',
      '@dqbd/tiktoken',
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
      /^@robota-sdk\/.*/, // All @robota-sdk packages (for peer dependencies)
      'zod',
      'fast-glob',
      // Node.js built-ins (CLI modules are node-only but share the entry point)
      'fs',
      'path',
      'node:child_process',
      'node:fs/promises',
      'node:path',
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
  },
]);
