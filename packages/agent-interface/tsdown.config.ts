import { defineConfig } from 'tsdown';

// One entry per contract family: a consumer's bundler reaches only the families it imports.
// `agent-core` is an optional peer dependency and stays external.
export default defineConfig({
  entry: {
    'analytics/index': 'src/analytics/index.ts',
    'command/index': 'src/command/index.ts',
    'execution/index': 'src/execution/index.ts',
    'session/index': 'src/session/index.ts',
    'session-mobility/index': 'src/session-mobility/index.ts',
    'session/testing/index': 'src/session/testing/index.ts',
    'transport/index': 'src/transport/index.ts',
    'transport/testing/index': 'src/transport/testing/index.ts',
    'tui/index': 'src/tui/index.ts',
  },
  format: { esm: {}, cjs: {} },
  outDir: 'dist',
  platform: 'neutral',
  clean: true,
  dts: true,
  sourcemap: false,
  treeshake: true,
  minify: true,
  outExtensions: ({ format }) => ({
    js: format === 'cjs' ? '.cjs' : '.js',
    dts: format === 'cjs' ? '.d.cts' : '.d.ts',
  }),
  deps: {
    neverBundle: [/^@robota-sdk\/.*/],
  },
});
