#!/usr/bin/env bun
/**
 * DIST-001 / RUNTIME-002 — Bun single-binary builds for the full CLI and headless desktop host. Bun is used for PACKAGING ONLY; the Node path
 * (bin/agent.cjs → dist/node/bin.js) is untouched. Run under Bun:
 *
 *   bun scripts/build-bun.mjs            # host target
 *   bun scripts/build-bun.mjs linux-x64  # matching native full CLI target
 *   bun scripts/build-bun.mjs headless    # matching native desktop target
 *
 * Prereq: run the normal build first so dist/node/bin.js (and dist/node/headless.js) exist. Binaries are written
 * to dist-bun/ (full) or dist-bun-headless/ (headless).
 * Two build-time fixes: stub ink's dev-only `react-devtools-core` static import, and
 * inject the real version via `--define __AGENT_VERSION__` (the single binary can't fs-walk for package.json).
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKoffiBunPlugin } from '../../../scripts/bun/koffi-bun-plugin.mjs';

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

const ARTIFACT_PREFIX = '__PRODUCT_ARTIFACT_PREFIX__';

export function nativeBuildSelection(packageRoot, kind, options = {}) {
  const defaultEntry = join(packageRoot, 'dist', 'node', kind === 'headless' ? 'headless.js' : 'bin.js');
  const entry = options.entry ? resolve(options.entry) : defaultEntry;
  if (!existsSync(entry)) throw new Error(`${entry} is missing; build the selected entry first.`);
  const artifactName = options.artifactName ?? (ARTIFACT_PREFIX.startsWith('__') ? 'robota' : ARTIFACT_PREFIX);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(artifactName)) throw new Error('Artifact name must be an executable basename.');
  return { entry, artifactName };
}

async function compileTarget(entry, outputRoot, version, key, kind, artifactName, metadata) {
  const name = `${kind === 'headless' ? `${artifactName}-headless` : artifactName}-${key}${key.startsWith('windows') ? '.exe' : ''}`;
  const outfile = join(outputRoot, name);
  const result = await Bun.build({
    entrypoints: [entry],
    target: 'bun',
    compile: { target: TARGETS[key], outfile },
    define: {
      __AGENT_VERSION__: JSON.stringify(version),
      __AGENT_SOURCE_VERSION__: JSON.stringify(metadata?.sourceVersion ?? version),
      __AGENT_BUILD_METADATA__: JSON.stringify(metadata?.buildMetadata ?? null),
    },
    plugins: [
      ...(kind === 'full' ? [stubReactDevtools] : []),
      createKoffiBunPlugin(
        `${process.platform}-${process.arch}`,
        new URL('../package.json', import.meta.url),
      ),
    ],
  });
  if (!result.success) throw new Error(`Bun compile failed: ${result.logs.map(String).join('\n')}`);
  if (!existsSync(outfile)) throw new Error(`Bun compile did not produce ${outfile}`);
  chmodSync(outfile, 0o755);
  return outfile;
}

/** Output directory for each binary kind, next to the package's dist/. */
export const BUN_OUTPUT = { full: 'dist-bun', headless: 'dist-bun-headless' };

export async function buildBunBinaries(packageRoot, keys, kind = 'full', options = {}) {
  if (kind !== 'full' && kind !== 'headless') throw new Error(`Unknown Bun artifact kind: ${kind}`);
  if (
    !keys.length ||
    new Set(keys).size !== keys.length ||
    keys.some((key) => !Object.hasOwn(TARGETS, key))
  ) {
    throw new Error(`Bun target must be unique and one of: ${Object.keys(TARGETS).join(', ')}`);
  }
  if (keys.length !== 1 || keys[0] !== bunTargetForHost()) {
    throw new Error(`Bun packaging requires the matching native host ${bunTargetForHost()}.`);
  }
  await import('./qualify-koffi-gc.mjs');
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  const metadataPath = join(packageRoot, '..', '..', '.product', 'artifact-metadata.json');
  const metadata = existsSync(metadataPath) ? JSON.parse(readFileSync(metadataPath, 'utf8')) : undefined;
  const { entry, artifactName } = nativeBuildSelection(packageRoot, kind, options);
  const outputRoot = join(packageRoot, BUN_OUTPUT[kind]);
  rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(outputRoot, { recursive: true });
  const binaries = [];
  for (const key of keys)
    binaries.push(await compileTarget(entry, outputRoot, manifest.version, key, kind, artifactName, metadata));
  return binaries;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const argv = process.argv.slice(2);
    const kind = argv[0] === 'headless' ? 'headless' : 'full';
    if (kind === 'headless') argv.shift();
    const options = {};
    let argument;
    for (let index = 0; index < argv.length; index += 1) {
      const token = argv[index];
      if (token === '--entry' || token === '--artifact-name') {
        const key = token === '--entry' ? 'entry' : 'artifactName';
        const value = argv[++index];
        if (!value || value.startsWith('--')) throw new Error(`${token} requires a value.`);
        options[key] = value;
      } else if (!token.startsWith('--') && argument === undefined) argument = token;
      else throw new Error(`Unexpected Bun build argument: ${token}`);
    }
    const keys = argument === 'all' ? Object.keys(TARGETS) : [argument ?? bunTargetForHost()];
    const binaries = await buildBunBinaries(
      join(dirname(fileURLToPath(import.meta.url)), '..'),
      keys,
      kind,
      options,
    );
    process.stdout.write(`Bun binaries: ${binaries.join(', ')}\n`);
  } catch (error) {
    process.stderr.write(`build-bun: ${error.message}\n`);
    process.exitCode = 1;
  }
}
