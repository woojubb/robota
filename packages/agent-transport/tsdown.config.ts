import { defineConfig } from 'tsdown';

const outExtensions = ({ format }: { format: string }) => ({
  js: format === 'cjs' ? '.cjs' : '.js',
  dts: '.d.ts',
});

const shared = {
  sourcemap: false,
  treeshake: true,
  minify: true,
  dts: true,
  outExtensions,
  deps: {
    neverBundle: [
      /^@robota-sdk\/.*/,
      /^ink/,
      /^react/,
      /^hono/,
      /^ws$/,
      /^@modelcontextprotocol\/.*/,
      /^zod$/,
      /^chalk$/,
      /^marked/,
      /^string-width$/,
    ],
  },
};

export default defineConfig({
  ...shared,
  entry: {
    index: 'src/index.ts',
    'tui/index': 'src/tui/index.ts',
    'headless/index': 'src/headless/index.ts',
    'http/index': 'src/http/index.ts',
    'ws/index': 'src/ws/index.ts',
    'mcp/index': 'src/mcp/index.ts',
  },
  format: ['esm', 'cjs'],
  outDir: 'dist/node',
  platform: 'node',
  clean: true,
});
