import { defineConfig } from 'tsup';

const baseConfig = {
  dts: {
    resolve: true,
    compilerOptions: {
      composite: false,
    },
  },
  splitting: false,
  sourcemap: false,
  clean: true,
  treeshake: true,
  skipNodeModulesBundle: true,
  external: [/^@robota-sdk\/.*/],
};

export default defineConfig([
  // Node.js build — full API including CLI tools (bash, glob, grep, etc.)
  {
    ...baseConfig,
    entry: { index: 'src/index.ts' },
    outDir: 'dist/node',
    format: ['esm', 'cjs'],
    platform: 'node',
    target: 'node18',
  },
  // Browser build — browser-safe subset only (FunctionTool, ToolRegistry, OpenAPITool)
  {
    ...baseConfig,
    entry: { browser: 'src/browser.ts' },
    outDir: 'dist/browser',
    format: ['esm'],
    platform: 'browser',
    minify: true,
    define: {
      'process.env.NODE_ENV': '"production"',
    },
    esbuildOptions(options) {
      options.drop = ['debugger'];
      options.dropLabels = ['DEV'];
      options.conditions = ['module', 'import', 'browser'];
    },
  },
]);
