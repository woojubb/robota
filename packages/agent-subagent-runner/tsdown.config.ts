import { defineConfig } from 'tsdown';

const outExtensions = ({ format }: { format: string }) => ({
  js: format === 'cjs' ? '.cjs' : '.js',
  dts: '.d.ts',
});

export default defineConfig({
  // The worker is a SEPARATE entry, not bundled into index: `getDefaultSubagentWorkerPath()`
  // forks `dist/node/child-process-subagent-worker.js` at runtime. Without this entry the file
  // never existed, so the child-process subagent silently failed from any dist build.
  entry: {
    index: 'src/index.ts',
    'child-process-subagent-worker': 'src/child-process-subagent-worker.ts',
  },
  format: ['esm', 'cjs'],
  outDir: 'dist/node',
  platform: 'node',
  sourcemap: false,
  treeshake: true,
  minify: true,
  dts: true,
  outExtensions,
  clean: true,
  deps: { neverBundle: [/^@robota-sdk\/.*/, /^node:.*/] },
});
