import { builtinModules } from 'node:module';

import { defineConfig } from 'tsdown';

const outExtensions = ({ format }: { format: string }) => ({
  js: format === 'cjs' ? '.cjs' : '.js',
  dts: format === 'cjs' ? '.d.cts' : '.d.ts',
});

// One entry per vendor subpath: a consumer's bundler never reaches another vendor's code or SDK.
// The vendor SDKs are optional peer dependencies and stay external.
export default defineConfig({
  entry: {
    'anthropic/index': 'src/anthropic/index.ts',
    'bytedance/index': 'src/bytedance/index.ts',
    'gemini/index': 'src/gemini/index.ts',
    'google/index': 'src/google/index.ts',
    'openai/index': 'src/openai/index.ts',
    'openai/loggers/index': 'src/openai/loggers/index.ts',
    'openai/node': 'src/openai/node.ts',
    'deepseek/index': 'src/deepseek/index.ts',
    'qwen/index': 'src/qwen/index.ts',
    'gemma/index': 'src/gemma/index.ts',
    'openai-compatible/index': 'src/openai-compatible/index.ts',
    'builtin/index': 'src/builtin/index.ts',
  },
  format: { esm: {}, cjs: {} },
  outDir: 'dist',
  platform: 'neutral',
  clean: true,
  dts: true,
  sourcemap: false,
  treeshake: true,
  minify: true,
  outExtensions,
  deps: { neverBundle: [/^@robota-sdk\/.*/, /^node:/, ...builtinModules] },
});
