import { builtinModules } from 'node:module';

import { defineConfig } from 'tsdown';

// One build serves every runtime. The `node` subpath and the carrier subpaths (`ws`, `http`, `mcp`,
// `acp`, `webrtc`, `link`) are Node only and share the neutral entries' chunks, but not one another's:
// a consumer that imports one carrier never reaches another carrier's code or library. The carrier
// libraries are optional peer dependencies and stay external.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    client: 'src/client.ts',
    node: 'src/node/index.ts',
    'ws/index': 'src/ws/index.ts',
    'http/index': 'src/http/index.ts',
    'mcp/index': 'src/mcp/index.ts',
    'acp/index': 'src/acp/index.ts',
    'webrtc/index': 'src/webrtc/index.ts',
    'link/index': 'src/link/index.ts',
  },
  format: { esm: {}, cjs: {} },
  outDir: 'dist',
  platform: 'neutral',
  clean: true,
  sourcemap: false,
  treeshake: true,
  minify: true,
  dts: true,
  outExtensions: ({ format }) => ({
    js: format === 'cjs' ? '.cjs' : '.js',
    dts: format === 'cjs' ? '.d.cts' : '.d.ts',
  }),
  deps: { neverBundle: [/^@robota-sdk\/.*/, /^node:/, ...builtinModules] },
});
