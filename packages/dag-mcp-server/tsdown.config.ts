const shared = {
  outDir: 'dist/node',
  clean: true,
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
