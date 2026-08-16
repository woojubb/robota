import { defineConfig } from 'tsdown';

const outExtensions = ({ format }: { format: string }) => ({
  js: format === 'cjs' ? '.cjs' : '.js',
  dts: '.d.ts',
});

export default defineConfig({
  // DIST-006: the worker is NO LONGER a separate entry. It was one because something had to locate
  // it on disk at runtime, and that assumption broke twice — first when the file was never emitted,
  // then when a downstream bundler inlined this package and moved "next to me" one package along.
  // Worker mode is now entered through `runSubagentWorkerMain()` from the composition root's own
  // entry, so there is no second artifact and no path to get wrong.
  entry: {
    index: 'src/index.ts',
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
