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
  minify: true,
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
      /^@robota-sdk\/.*/,  // All @robota-sdk packages
      'openai'
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
      /^@robota-sdk\/.*/,  // All @robota-sdk packages
      'openai'
    ],
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