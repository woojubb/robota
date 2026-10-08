import { defineConfig } from 'tsdown';
import { existsSync, readFileSync } from 'node:fs';

import manifest from './package.json' with { type: 'json' };

const metadataPath = new URL('../../.product/artifact-metadata.json', import.meta.url);
const metadata = existsSync(metadataPath) ? JSON.parse(readFileSync(metadataPath, 'utf8')) as { sourceVersion: string; buildMetadata: string | null } : undefined;
const define = {
  __AGENT_VERSION__: JSON.stringify(manifest.version),
  __AGENT_SOURCE_VERSION__: JSON.stringify(metadata?.sourceVersion ?? manifest.version),
  __AGENT_BUILD_METADATA__: JSON.stringify(metadata?.buildMetadata ?? null),
};

export default defineConfig([
  {
    entry: { bin: 'src/bin.ts', headless: 'src/headless-bin.ts' },
    define,
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
    define,
    // ESM only: the bundle loads ink, whose yoga-layout entry has a top-level await, so a CommonJS
    // build could never be require()d (ERR_REQUIRE_ASYNC_MODULE). package.json exports no `require`.
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
    // INFRA-028: bundle @robota-sdk into the library entry too; third-party (in `dependencies`) external.
  },
]);
