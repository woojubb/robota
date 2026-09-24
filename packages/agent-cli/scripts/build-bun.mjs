#!/usr/bin/env bun
/**
 * DIST-001 / RUNTIME-002 — Bun single-binary builds for the full CLI and headless desktop host. Bun is used for PACKAGING ONLY; the Node path
 * (bin/robota.cjs → dist/node/bin.js) is untouched. Run under Bun:
 *
 *   bun scripts/build-bun.mjs            # host target
 *   bun scripts/build-bun.mjs linux-x64  # matching native full CLI target
 *   bun scripts/build-bun.mjs headless    # matching native desktop target
 *
 * Prereq: run the normal build first so dist/node/bin.js (and dist/node/headless.js) exist. Binaries are written
 * to dist-bun/ (full) or dist-bun-headless/ (headless).
 * Two build-time fixes (see the DIST-001 spec): stub ink's dev-only `react-devtools-core` static import, and
 * inject the real version via `--define __ROBOTA_VERSION__` (the single binary can't fs-walk for package.json).
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

async function compileTarget(entry, outputRoot, version, key, kind) {
  const name = `${kind === 'headless' ? 'robota-headless' : 'robota'}-${key}${key.startsWith('windows') ? '.exe' : ''}`;
  const outfile = join(outputRoot, name);
  const result = await Bun.build({
    entrypoints: [entry],
    target: 'bun',
    compile: { target: TARGETS[key], outfile },
    define: { __ROBOTA_VERSION__: JSON.stringify(version) },
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

export async function buildBunBinaries(packageRoot, keys, kind = 'full') {
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
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  const entry = join(packageRoot, 'dist', 'node', kind === 'headless' ? 'headless.js' : 'bin.js');
  if (!existsSync(entry)) throw new Error(`${entry} is missing; run the package build first.`);
  const outputRoot = join(packageRoot, BUN_OUTPUT[kind]);
  rmSync(outputRoot, { recursive: true, force: true });
  mkdirSync(outputRoot, { recursive: true });
  const binaries = [];
  for (const key of keys)
    binaries.push(await compileTarget(entry, outputRoot, manifest.version, key, kind));
  return binaries;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const kind = process.argv[2] === 'headless' ? 'headless' : 'full';
  const argument = process.argv[kind === 'headless' ? 3 : 2];
  const keys = argument === 'all' ? Object.keys(TARGETS) : [argument ?? bunTargetForHost()];
  try {
    const binaries = await buildBunBinaries(
      join(dirname(fileURLToPath(import.meta.url)), '..'),
      keys,
      kind,
    );
    process.stdout.write(`Bun binaries: ${binaries.join(', ')}\n`);
  } catch (error) {
    process.stderr.write(`build-bun: ${error.message}\n`);
    process.exitCode = 1;
  }
}
