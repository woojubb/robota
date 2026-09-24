import { defineConfig } from 'tsdown';

const shared = {
  sourcemap: false,
  treeshake: true,
  minify: true,
  dts: true,
  outExtensions: ({ format }: { format: string }) => ({
    js: format === 'cjs' ? '.cjs' : '.js',
    dts: format === 'cjs' ? '.d.cts' : '.d.ts',
  }),
  deps: {
    neverBundle: [/^@robota-sdk\/.*/],
  },
};

export default defineConfig([
  {
    ...shared,
    entry: {
      index: 'src/index.ts',
      node: 'src/node/index.ts',
    },
    format: { esm: {}, cjs: {} },
    outDir: 'dist/node',
    platform: 'node',
    clean: true,
  },
  {
    ...shared,
    entry: {
      index: 'src/index.ts',
      client: 'src/client.ts',
    },
    format: ['esm'],
    outDir: 'dist/browser',
    platform: 'browser',
  },
]);
