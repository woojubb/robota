export default {
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  outDir: 'dist/node',
  clean: true,
  outExtensions: (ctx) => ({
    js: ctx.format === 'cjs' ? '.cjs' : '.js',
    dts: ctx.format === 'cjs' ? '.d.cts' : '.d.ts',
  }),
};
