import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    entry: { bin: 'src/bin.ts' },
    format: ['esm'],
    outDir: 'dist/node',
    platform: 'node',
    clean: false,
    dts: true,
    sourcemap: false,
    treeshake: true,
    minify: true,
    splitting: false,
    outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
    deps: { neverBundle: [/^@robota-sdk\/.*/] },
  },
  {
    entry: {
      index: 'src/index.ts',
      'subagents/child-process-subagent-worker': 'src/subagents/child-process-subagent-worker.ts',
    },
    format: ['esm', 'cjs'],
    outDir: 'dist/node',
    platform: 'node',
    clean: false,
    dts: true,
    sourcemap: false,
    treeshake: true,
    minify: true,
    splitting: false,
    outExtensions: ({ format }) => ({
      js: format === 'cjs' ? '.cjs' : '.js',
      dts: '.d.ts',
    }),
    deps: { neverBundle: [/^@robota-sdk\/.*/] },
  },
]);
