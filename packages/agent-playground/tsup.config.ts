import { defineConfig } from 'tsup';

const baseConfig = {
  dts: {
    resolve: true,
    compilerOptions: {
      composite: false,
      stripInternal: true,
    },
  },
  splitting: false,
  sourcemap: false,
  clean: true,
  treeshake: true,
  minify: true,
  entry: ['src/index.ts'],
  external: [
    /^@robota-sdk\/.*/,
    'react',
    'react-dom',
    /^@radix-ui\/.*/,
    /^@xyflow\/react(\/.*)?$/,
    'lucide-react',
    'react-markdown',
    'remark-gfm',
    'sonner',
    '@monaco-editor/react',
    'monaco-editor',
    'dagre',
    'clsx',
    'tailwind-merge',
    'class-variance-authority',
  ],
  esbuildOptions(options) {
    options.loader = {
      ...(options.loader ?? {}),
      '.css': 'css',
    };
  },
};

export default defineConfig([
  {
    ...baseConfig,
    outDir: 'dist/node',
    format: ['esm', 'cjs'],
    platform: 'node',
  },
  {
    ...baseConfig,
    outDir: 'dist/browser',
    format: ['esm'],
    platform: 'browser',
    define: {
      'process.env.NODE_ENV': '"production"',
    },
    esbuildOptions(options) {
      baseConfig.esbuildOptions(options);
      options.drop = ['debugger'];
      options.dropLabels = ['DEV'];
    },
  },
]);
