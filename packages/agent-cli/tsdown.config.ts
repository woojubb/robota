import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    entry: { bin: 'src/bin.ts' },
    format: ['esm'],
    outDir: 'dist/node',
    platform: 'node',
    clean: false,
    dts: true,
    sourcemap: false,
    treeshake: true,
    minify: true,
    splitting: false,
    outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
    deps: { neverBundle: [/^@robota-sdk\/.*/] },
    banner: {
      js: `;(function(){var v=parseInt(process.versions.node.split('.')[0],10);if(v<22){process.stderr.write('\\n✗ Node.js 22+ is required (current: '+process.version+')\\n\\nUpgrade:\\n  nvm:   nvm install 22 && nvm use 22\\n  Volta: volta install node@22\\n  Download: https://nodejs.org/en/download\\n\\n');process.exit(1);}})();`,
    },
  },
  {
    entry: {
      index: 'src/index.ts',
    },
    format: ['esm', 'cjs'],
    outDir: 'dist/node',
    platform: 'node',
    clean: false,
    dts: true,
    sourcemap: false,
    treeshake: true,
    minify: true,
    splitting: false,
    outExtensions: ({ format }) => ({
      js: format === 'cjs' ? '.cjs' : '.js',
      dts: '.d.ts',
    }),
    deps: { neverBundle: [/^@robota-sdk\/.*/] },
  },
]);
