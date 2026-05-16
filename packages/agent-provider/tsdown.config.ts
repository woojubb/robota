import { defineConfig } from 'tsdown';

const outExtensions = ({ format }: { format: string }) => ({
  js: format === 'cjs' ? '.cjs' : '.js',
  dts: '.d.ts',
});

const shared = {
  sourcemap: false,
  treeshake: true,
  minify: true,
  dts: true,
  outExtensions,
  deps: { neverBundle: [/^@robota-sdk\/.*/] },
};

export default defineConfig([
  {
    ...shared,
    entry: {
      index: 'src/index.ts',
      'anthropic/index': 'src/anthropic/index.ts',
      'openai/index': 'src/openai/index.ts',
      'deepseek/index': 'src/deepseek/index.ts',
      'gemini/index': 'src/gemini/index.ts',
      'google/index': 'src/google/index.ts',
      'gemma/index': 'src/gemma/index.ts',
      'bytedance/index': 'src/bytedance/index.ts',
      'qwen/index': 'src/qwen/index.ts',
    },
    format: ['esm', 'cjs'],
    outDir: 'dist/node',
    platform: 'node',
    clean: true,
  },
  {
    ...shared,
    entry: {
      index: 'src/openai/loggers/index.ts',
    },
    format: ['esm', 'cjs'],
    outDir: 'dist/loggers',
    platform: 'node',
    clean: false,
  },
  {
    ...shared,
    entry: { index: 'src/index.ts' },
    format: ['esm'],
    outDir: 'dist/browser',
    platform: 'browser',
    outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
    define: { 'process.env.NODE_ENV': '"production"' },
    clean: false,
  },
]);
