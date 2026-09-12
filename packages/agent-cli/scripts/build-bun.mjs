#!/usr/bin/env bun
/**
 * DIST-001 — Bun single-binary build for the `robota` CLI. Bun is used for PACKAGING ONLY; the Node path
 * (bin/robota.cjs → dist/node/bin.js) is untouched. Run under Bun:
 *
 *   bun scripts/build-bun.mjs            # host target
 *   bun scripts/build-bun.mjs all        # every target
 *   bun scripts/build-bun.mjs linux-x64  # a specific target
 *
 * Prereq: run the normal build first to produce a verified generation containing dist/node/bin.js.
 * Two build-time fixes (see the DIST-001 spec): stub ink's dev-only `react-devtools-core` static import, and
 * inject the real version via `--define __ROBOTA_VERSION__` (the single binary can't fs-walk for package.json).
 */

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleGeneration, pinGeneration } from '../../../scripts/artifacts/generation.mjs';
import { createManifest, validateArtifactPath } from '../../../scripts/artifacts/manifest.mjs';

/** os-arch → Bun `--compile` target triple. */
const TARGETS = {
  'darwin-arm64': 'bun-darwin-arm64',
  'darwin-x64': 'bun-darwin-x64',
  'linux-x64': 'bun-linux-x64',
  'linux-arm64': 'bun-linux-arm64',
  'windows-x64': 'bun-windows-x64',
};

/** ink 7.x statically imports `react-devtools-core` in a DEV-only code path; stub it so the binary self-contains. */
const stubReactDevtools = {
  name: 'stub-react-devtools',
  setup(build) {
    build.onResolve({ filter: /^react-devtools-core$/ }, () => ({
      path: 'rdc',
      namespace: 'stub-rdc',
    }));
    build.onLoad({ filter: /.*/, namespace: 'stub-rdc' }, () => ({
      contents: 'export default {}; export function connectToDevTools(){}',
      loader: 'js',
    }));
  },
};

function hostKey() {
  const os = process.platform === 'win32' ? 'windows' : process.platform; // darwin | linux | windows
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  return `${os}-${arch}`;
}

async function compileTarget(entry, outputRoot, version, key) {
  const name = `robota-${key}${key.startsWith('windows') ? '.exe' : ''}`;
  // Bun 1.3's returned Blob is not the final executable bytes. Capture its explicitly nominated
  // executable in a fresh compiler spool, separate from the generation tree being verified.
  const compilerRoot = join(dirname(outputRoot), 'bun-emitter');
  mkdirSync(compilerRoot, { recursive: true });
  const outfile = join(compilerRoot, name);
  const result = await Bun.build({
    entrypoints: [entry],
    target: 'bun',
    compile: { target: TARGETS[key], outfile },
    define: { __ROBOTA_VERSION__: JSON.stringify(version) },
    plugins: [stubReactDevtools],
  });
  if (!result.success) throw new Error(`Bun compile failed: ${result.logs.map(String).join('\n')}`);
  if (result.outputs.length !== 1 || resolve(result.outputs[0].path) !== outfile) {
    throw new Error(`Bun compile did not report the declared executable: ${outfile}`);
  }
  const contents = readFileSync(outfile);
  const destination = join(outputRoot, name);
  writeFileSync(destination, contents, { flag: 'wx', mode: 0o755 });
  chmodSync(destination, 0o755);
  return { path: validateArtifactPath(relative(outputRoot, destination)), contents, mode: 0o755 };
}

export async function buildBunBinaryGeneration(packageRoot, keys) {
  if (
    !keys.length ||
    new Set(keys).size !== keys.length ||
    keys.some((key) => !Object.hasOwn(TARGETS, key))
  ) {
    throw new Error(`Bun target must be unique and one of: ${Object.keys(TARGETS).join(', ')}`);
  }
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  const outputName = manifest.robota?.artifact?.variants?.bun?.output;
  if (outputName !== 'dist-bun')
    throw new Error('Bun output variant must be explicitly declared as dist-bun');
  const pinned = pinGeneration(packageRoot);
  const entry = join(pinned.root, 'node/bin.js');
  return assembleGeneration(
    packageRoot,
    async ({ outputRoot }) => {
      const records = [];
      for (const key of keys)
        records.push(await compileTarget(entry, outputRoot, manifest.version, key));
      return createManifest(records);
    },
    { outputName },
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argument = process.argv[2];
  const keys = argument === 'all' ? Object.keys(TARGETS) : [argument ?? hostKey()];
  try {
    const result = await buildBunBinaryGeneration(
      join(dirname(fileURLToPath(import.meta.url)), '..'),
      keys,
    );
    process.stdout.write(`Bun generation ${result.id}: ${result.manifest.files.length} binaries\n`);
  } catch (error) {
    process.stderr.write(`build-bun: ${error.message}\n`);
    process.exitCode = 1;
  }
}
