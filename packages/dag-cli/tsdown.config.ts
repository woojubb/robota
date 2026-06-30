export default {
  entry: ['src/index.ts', 'src/bin.ts'],
  format: ['esm', 'cjs'],
  outDir: 'dist/node',
  clean: true,
  deps: {
    // Bundle all node_modules inline — dag-cli is a fully standalone CLI.
    // Only Node.js builtins and @modelcontextprotocol/sdk remain external.
    bundleNodeModules: true,
  },
  outExtensions: (ctx) => ({
    js: ctx.format === 'cjs' ? '.cjs' : '.js',
    dts: ctx.format === 'cjs' ? '.d.cts' : '.d.ts',
  }),
};
