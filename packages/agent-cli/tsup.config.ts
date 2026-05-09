import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: {
      bin: 'src/bin.ts',
    },
    format: ['esm'],
    outDir: 'dist/node',
    dts: true,
    clean: false,
  },
  {
    entry: {
      index: 'src/index.ts',
      'subagents/child-process-subagent-worker': 'src/subagents/child-process-subagent-worker.ts',
    },
    format: ['esm', 'cjs'],
    outDir: 'dist/node',
    dts: true,
    clean: false,
  },
]);
