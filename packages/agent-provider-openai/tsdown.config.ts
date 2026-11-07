import { builtinModules } from 'node:module';

import { defineConfig } from 'tsdown';

const outExtensions = ({ format }: { format: string }) => ({
  js: format === 'cjs' ? '.cjs' : '.js',
  dts: format === 'cjs' ? '.d.cts' : '.d.ts',
});

const shared = {
  format: { esm: {}, cjs: {} } as const,
  outDir: 'dist',
  platform: 'neutral' as const,
  clean: true,
  dts: true,
  sourcemap: false,
  treeshake: true,
  minify: true,
  outExtensions,
  deps: { neverBundle: [/^@robota-sdk\/.*/, /^node:/, ...builtinModules] },
};

export default defineConfig({
  ...shared,
  entry: {
    index: 'src/index.ts',
    'loggers/index': 'src/openai/loggers/index.ts',
    node: 'src/node.ts',
  },
});
