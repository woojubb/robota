import { defineConfig } from 'tsdown';

export default defineConfig({
  // `session` is the `./session` subpath: `sessionParticipant` and its Session-specific types/codec,
  // kept out of the `index` entry so a consumer who only wants `runtimeParticipant`/`runtimeSelector`
  // never resolves `@robota-sdk/agent-session` (and, through it, agent-file-authority's native
  // koffi binary) just by importing this package's root.
  entry: { index: 'src/index.ts', session: 'src/session.ts' },
  format: { esm: {}, cjs: {} },
  outDir: 'dist',
  platform: 'node',
  clean: true,
  dts: true,
  outExtensions: ({ format }) => ({
    js: format === 'cjs' ? '.cjs' : '.js',
    dts: format === 'cjs' ? '.d.cts' : '.d.ts',
  }),
  deps: {
    neverBundle: [/^@robota-sdk\//],
  },
});
