import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    entry: { bin: 'src/bin.ts' },
    format: ['esm'],
    outDir: 'dist/node',
    platform: 'node',
    clean: false,
    // bin is an executable, not a typed module — no .d.ts needed (also avoids bundling 41 pkgs' d.ts).
    dts: false,
    sourcemap: false,
    treeshake: true,
    minify: true,
    splitting: false,
    outExtensions: () => ({ js: '.js' }),
    // INFRA-028: bundle ALL @robota-sdk workspace code into the self-contained artifact. Only the
    // third-party npm packages declared in package.json `dependencies` stay external.
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
    // INFRA-028: bundle @robota-sdk into the library entry too; third-party (in `dependencies`) external.
  },
]);
