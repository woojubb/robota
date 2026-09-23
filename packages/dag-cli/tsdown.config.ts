import manifest from './package.json' with { type: 'json' };

const shared = {
  define: { __ROBOTA_DAG_CLI_VERSION__: JSON.stringify(manifest.version) },
  outDir: 'dist/node',
  clean: true,
  deps: {
    // Bundle all node_modules inline — dag-cli is a fully standalone CLI.
    // Bundle runtime dependencies for the standalone CLI.
    bundleNodeModules: true,
  },
  outExtensions: (ctx) => ({
    js: ctx.format === 'cjs' ? '.cjs' : '.js',
    dts: ctx.format === 'cjs' ? '.d.cts' : '.d.ts',
  }),
};

// The executable is ESM-only. Do not emit then delete files from a sealed generation.
export default [
  { ...shared, entry: ['src/index.ts'], format: ['esm', 'cjs'] },
  { ...shared, entry: ['src/bin.ts'], format: ['esm'] },
];
