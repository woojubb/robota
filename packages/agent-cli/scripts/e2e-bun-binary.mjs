#!/usr/bin/env node
/**
 * DIST-001 — e2e smoke for the Bun single-binary. Builds the host binary and runs it: asserts `--version`
 * prints the REAL version (not the `0.0.0` fs-walk fallback), `--help` prints usage (exit 0), and both are
 * no-provider paths (no API key needed). GUARDS on Bun: when `bun` is unavailable on PATH the test SKIPS
 * (exit 0, not fail) so CI without Bun stays green.
 */

import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertStandaloneNativeRuntime,
  runNativeFileAuthorityE2e,
} from './e2e-native-file-authority.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(here, '..'); // packages/agent-cli

// Guard: skip (not fail) when Bun is unavailable.
if (spawnSync('bun', ['--version'], { encoding: 'utf8' }).status !== 0) {
  console.log(
    'SKIP: `bun` not on PATH — DIST-001 compiled-binary e2e skipped (Node path is unaffected).',
  );
  process.exit(0);
}

const entry = join(pkgDir, 'dist', 'node', 'bin.js');
if (!existsSync(entry)) {
  console.error(
    'e2e: dist/node/bin.js missing — run `pnpm --filter @robota-sdk/agent-cli build` first.',
  );
  process.exit(1);
}

// Build the host target.
const build = spawnSync('bun', [join(pkgDir, 'scripts', 'build-bun.mjs')], {
  cwd: pkgDir,
  encoding: 'utf8',
});
process.stdout.write(build.stdout ?? '');
process.stderr.write(build.stderr ?? '');
if (build.status !== 0) {
  console.error('e2e: bun build failed');
  process.exit(1);
}

const os = process.platform === 'win32' ? 'windows' : process.platform;
const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
const bin = join(pkgDir, 'dist-bun', `robota-${os}-${arch}${os === 'windows' ? '.exe' : ''}`);
if (!existsSync(bin)) {
  console.error(`e2e: host binary not produced at ${bin}`);
  process.exit(1);
}

const expectedVersion = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version;

let failures = 0;
const check = (label, ok) => {
  console.log(`${ok ? '✓' : '✗'} ${label}`);
  if (!ok) failures += 1;
};

const cleanRoot = mkdtempSync(join(tmpdir(), 'robota-bun-standalone-'));
try {
  const standalone = join(cleanRoot, basename(bin));
  copyFileSync(bin, standalone);
  chmodSync(standalone, 0o755);
  try {
    assertStandaloneNativeRuntime(standalone);
    check('standalone fixture has no node_modules ancestor', true);
  } catch (error) {
    console.error(error);
    check('standalone fixture has no node_modules ancestor', false);
  }

  const ver = spawnSync(standalone, ['--version'], { encoding: 'utf8' });
  check('--version exits 0', ver.status === 0);
  check(
    `--version prints the real version (${expectedVersion}), not the 0.0.0 fallback`,
    (ver.stdout ?? '').includes(expectedVersion) && !(ver.stdout ?? '').includes('0.0.0'),
  );

  const help = spawnSync(standalone, ['--help'], { encoding: 'utf8' });
  check('--help exits 0', help.status === 0);
  check('--help prints usage', /Usage:\s*robota/.test(help.stdout ?? ''));

  try {
    console.log(runNativeFileAuthorityE2e(standalone));
    check('native replay succeeds and replaced parent is refused', true);
  } catch (error) {
    console.error(error);
    check('native replay succeeds and replaced parent is refused', false);
  }
} finally {
  rmSync(cleanRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}

console.log(
  failures === 0 ? '\nDIST-001 BINARY E2E PASSED' : `\nDIST-001 BINARY E2E FAILED (${failures})`,
);
process.exit(failures === 0 ? 0 : 1);
