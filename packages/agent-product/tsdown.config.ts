import { builtinModules } from 'node:module';

import { defineConfig } from 'tsdown';

const outExtensions = ({ format }: { format: string }) => ({
  js: format === 'cjs' ? '.cjs' : '.js',
  dts: format === 'cjs' ? '.d.cts' : '.d.ts',
});

// One entry per subpath. The subpaths share no code except through the package's own chunks, so a
// consumer's bundler never reaches the Node-only `./preset/node`, `./command/node` or `./coding` from
// a neutral entry; `./personal` is Node-only like `./coding`. Repository packages and Node built-ins stay external.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'capability-pack/index': 'src/capability-pack/index.ts',
    'preset/index': 'src/preset/index.ts',
    'preset/node': 'src/preset/node.ts',
    'command/index': 'src/command/index.ts',
    'command/node': 'src/command/node.ts',
    'coding/index': 'src/coding/index.ts',
    'personal/index': 'src/personal/index.ts',
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
