#!/usr/bin/env bun
/**
 * DIST-001 — Bun single-binary build for the `robota` CLI. Bun is used for PACKAGING ONLY; the Node path
 * (bin/robota.cjs → dist/node/bin.js) is untouched. Run under Bun:
 *
 *   bun scripts/build-bun.mjs            # host target
 *   bun scripts/build-bun.mjs linux-x64  # the exact matching host target
 *
 * Prereq: run the normal build first to produce a verified generation containing dist/node/bin.js.
 * Two build-time fixes (see the DIST-001 spec): stub ink's dev-only `react-devtools-core` static import, and
 * inject the real version via `--define __ROBOTA_VERSION__` (the single binary can't fs-walk for package.json).
 */

import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleGeneration, pinGeneration } from '../../../scripts/artifacts/generation.mjs';
import { createKoffiBunPlugin } from '../../../scripts/artifacts/koffi-bun-plugin.mjs';
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

export function bunTargetForHost(platform = process.platform, arch = process.arch) {
  const os = platform === 'win32' ? 'windows' : platform;
  const key = `${os}-${arch}`;
  if (!Object.hasOwn(TARGETS, key)) {
    throw new Error(`Bun standalone packaging is unsupported on host ${platform}-${arch}.`);
  }
  return key;
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
    plugins: [
      stubReactDevtools,
      createKoffiBunPlugin(
        `${process.platform}-${process.arch}`,
        new URL('../package.json', import.meta.url),
      ),
    ],
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

export async function buildBunBinaryGeneration(packageRoot, key = bunTargetForHost()) {
  if (!Object.hasOwn(TARGETS, key)) {
    throw new Error(`Bun target must be one of: ${Object.keys(TARGETS).join(', ')}`);
  }
  const hostTarget = bunTargetForHost();
  if (key !== hostTarget) {
    throw new Error(`Bun target ${key} does not match the native host ${hostTarget}.`);
  }
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  const outputName = manifest.robota?.artifact?.variants?.bun?.output;
  if (outputName !== 'dist-bun')
    throw new Error('Bun output variant must be explicitly declared as dist-bun');
  const pinned = pinGeneration(packageRoot);
  const entry = join(pinned.root, 'node/bin.js');
  return assembleGeneration(
    packageRoot,
    async ({ outputRoot }) =>
      createManifest([await compileTarget(entry, outputRoot, manifest.version, key)]),
    { outputName },
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const arguments_ = process.argv.slice(2);
    if (arguments_.length > 1) {
      throw new Error('Bun packaging accepts exactly one target.');
    }
    const result = await buildBunBinaryGeneration(
      join(dirname(fileURLToPath(import.meta.url)), '..'),
      arguments_[0],
    );
    process.stdout.write(`Bun generation ${result.id}: ${result.manifest.files.length} binary\n`);
  } catch (error) {
    process.stderr.write(`build-bun: ${error.message}\n`);
    process.exitCode = 1;
  }
}
