#!/usr/bin/env bun
/**
 * DIST-001 — Bun single-binary build for the `robota` CLI. Bun is used for PACKAGING ONLY; the Node path
 * (bin/robota.cjs → dist/node/bin.js) is untouched. Run under Bun:
 *
 *   bun scripts/build-bun.mjs            # host target
 *   bun scripts/build-bun.mjs all        # every target
 *   bun scripts/build-bun.mjs linux-x64  # a specific target
 *
 * Prereq: the normal build has produced dist/node/bin.js (the `build:bun` npm script runs `pnpm build` first).
 * Two build-time fixes (see the DIST-001 spec): stub ink's dev-only `react-devtools-core` static import, and
 * inject the real version via `--define __ROBOTA_VERSION__` (the single binary can't fs-walk for package.json).
 */

import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(here, '..'); // packages/agent-cli
const entry = join(pkgDir, 'dist', 'node', 'bin.js');
const outDir = join(pkgDir, 'dist', 'bin');

if (!existsSync(entry)) {
  console.error(
    `build-bun: missing ${entry}. Run \`pnpm --filter @robota-sdk/agent-cli build\` first.`,
  );
  process.exit(1);
}

const version = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version;

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

const arg = process.argv[2];
const keys =
  arg === 'all' || arg === undefined ? (arg === 'all' ? Object.keys(TARGETS) : [hostKey()]) : [arg];

for (const key of keys) {
  const target = TARGETS[key];
  if (!target) {
    console.error(
      `build-bun: unknown target "${key}". Known: ${Object.keys(TARGETS).join(', ')} | all`,
    );
    process.exit(1);
  }
  mkdirSync(outDir, { recursive: true });
  const outfile = join(outDir, `robota-${key}${key.startsWith('windows') ? '.exe' : ''}`);
  const result = await Bun.build({
    entrypoints: [entry],
    target: 'bun',
    compile: { target, outfile },
    define: { __ROBOTA_VERSION__: JSON.stringify(version) },
    plugins: [stubReactDevtools],
  });
  if (!result.success) {
    for (const log of result.logs) console.error(String(log));
    process.exit(1);
  }
  console.log(`✓ robota ${version} → ${outfile} (${target})`);
}
