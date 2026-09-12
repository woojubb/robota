#!/usr/bin/env node
/**
 * ARCH-005 S3 — the external-consumer proof runner.
 *
 * Proves, from genuinely OUTSIDE the monorepo, that a third party can build a product on Robota's
 * PUBLISHED package surface. It is deliberately not a workspace link and not a relative import: the
 * runner packs verified physical generations through the artifact pack owner, installs them with `npm install`
 * into a throwaway directory outside the repo, type-checks the consumer against the SHIPPED `.d.ts`
 * files, and runs the Mode A/B/C assertions.
 *
 * OPT-IN by design — it packs + installs (network, tens of seconds), so it is NOT part of `pnpm test`.
 * Run it explicitly:
 *
 *   pnpm build                 # the tarballs are packed from dist/, so the build must be current
 *   pnpm proof:external        # or: node scripts/external-proof/run-external-proof.mjs
 *
 * Flags:
 *   --workdir <path>   use a specific working directory (must be outside the repo)
 *   --keep             do not delete the working directory on success (for inspection)
 *
 * Exit code 0 = every assertion in all three modes passed.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packVerifiedPackage } from '../artifacts/pack.mjs';
import { readWorkspaceVersions } from '../artifacts/pack-image.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..', '..');
const FIXTURE_DIR = path.join(SCRIPT_DIR, 'fixture');

/**
 * The packages the external consumer imports directly. Their workspace dependency closure is derived
 * mechanically below, so adding a dependency to any of them cannot silently break the proof.
 */
const ENTRY_PACKAGES = [
  '@robota-sdk/agent-product',
  '@robota-sdk/agent-capability-pack',
  '@robota-sdk/pack-coding',
  '@robota-sdk/agent-preset',
  '@robota-sdk/agent-builtin-providers',
  '@robota-sdk/agent-core',
  '@robota-sdk/agent-framework',
];

function log(message) {
  process.stdout.write(`${message}\n`);
}

function run(command, args, options) {
  return execFileSync(command, args, { encoding: 'utf8', ...options });
}

/** Read every workspace package manifest under `packages/`. */
function readWorkspaceManifests() {
  const packagesDir = path.join(REPO_ROOT, 'packages');
  const manifests = new Map();
  for (const entry of fs.readdirSync(packagesDir)) {
    const manifestPath = path.join(packagesDir, entry, 'package.json');
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifests.set(manifest.name, { dir: path.join(packagesDir, entry), manifest });
  }
  return manifests;
}

/** Transitive `workspace:` dependency closure of the entry packages, in deterministic order. */
function resolveClosure(manifests) {
  const closure = new Set();
  const queue = [...ENTRY_PACKAGES];
  while (queue.length > 0) {
    const name = queue.shift();
    if (closure.has(name)) continue;
    const entry = manifests.get(name);
    if (entry === undefined) {
      throw new Error(`external-proof: "${name}" is not a workspace package under packages/.`);
    }
    closure.add(name);
    for (const [dep, range] of Object.entries(entry.manifest.dependencies ?? {})) {
      if (String(range).startsWith('workspace:')) queue.push(dep);
    }
  }
  return [...closure].sort();
}

/** Pack each verified generation; returns name → verified absolute tarball path. */
export async function packAll(
  closure,
  manifests,
  tarballDir,
  workspaceVersions = readWorkspaceVersions(REPO_ROOT),
) {
  fs.mkdirSync(tarballDir, { recursive: true });
  const tarballs = new Map();
  for (const name of closure) {
    const { dir } = manifests.get(name);
    const { tarballPath } = await packVerifiedPackage(dir, {
      destination: tarballDir,
      workspaceRoot: REPO_ROOT,
      workspaceVersions,
    });
    tarballs.set(name, tarballPath);
    log(`  packed ${name} → ${path.basename(tarballPath)}`);
  }
  return tarballs;
}

/**
 * The consumer manifest. Every `@robota-sdk/*` specifier is a `file:` tarball — both as a direct
 * dependency and as an `overrides` entry — so nothing resolves from the npm registry. That matters:
 * `@robota-sdk/agent-core` IS published at this version, so without the overrides npm would silently
 * install the REGISTRY build for the transitive deps and the proof would not be testing this tree.
 */
export function writeConsumerManifest(consumerDir, tarballs) {
  // npm resolves file references from the physical consumer directory, as pack returns physical paths.
  const physicalConsumerDir = fs.realpathSync(consumerDir);
  const specs = Object.fromEntries(
    [...tarballs].map(([name, tarballPath]) => [
      name,
      `file:${path.relative(physicalConsumerDir, tarballPath)}`,
    ]),
  );
  const manifest = {
    name: 'acme-external-consumer',
    version: '0.0.0',
    private: true,
    type: 'module',
    description: 'ARCH-005 S3 — a third-party product built on the published Robota packages.',
    scripts: { build: 'tsc -p tsconfig.json', proof: 'node dist/proof.js' },
    dependencies: specs,
    devDependencies: { '@types/node': '^20.19.43', typescript: '^5.9.3' },
    overrides: specs,
  };
  fs.writeFileSync(
    path.join(consumerDir, 'package.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

async function main() {
  const argv = process.argv.slice(2);
  const keep = argv.includes('--keep');
  const workdirFlag = argv.indexOf('--workdir');
  const workdir =
    workdirFlag >= 0
      ? path.resolve(argv[workdirFlag + 1])
      : fs.mkdtempSync(path.join(os.tmpdir(), 'robota-external-proof-'));

  // The whole point is "outside the monorepo" — refuse to run anywhere inside it.
  const relativeToRepo = path.relative(REPO_ROOT, workdir);
  if (
    relativeToRepo !== '' &&
    !relativeToRepo.startsWith('..') &&
    !path.isAbsolute(relativeToRepo)
  ) {
    throw new Error(
      `external-proof: the working directory must be OUTSIDE the repo (got ${workdir}). ` +
        'An in-repo consumer would resolve workspace sources and prove nothing.',
    );
  }

  const consumerDir = path.join(workdir, 'consumer');
  const tarballDir = path.join(workdir, 'tarballs');
  fs.mkdirSync(consumerDir, { recursive: true });

  log(
    `ARCH-005 S3 — external-consumer proof\n  repo:     ${REPO_ROOT}\n  consumer: ${consumerDir}\n`,
  );

  const manifests = readWorkspaceManifests();
  const closure = resolveClosure(manifests);

  log(`[1/5] pnpm pack — ${closure.length} published packages (workspace dependency closure)`);
  const tarballs = await packAll(closure, manifests, tarballDir);

  log('\n[2/5] materialising the external consumer package');
  fs.cpSync(path.join(FIXTURE_DIR, 'src'), path.join(consumerDir, 'src'), { recursive: true });
  fs.copyFileSync(path.join(FIXTURE_DIR, 'tsconfig.json'), path.join(consumerDir, 'tsconfig.json'));
  writeConsumerManifest(consumerDir, tarballs);

  log('\n[3/5] npm install (real tarball install — no workspace link, no relative import)');
  run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], {
    cwd: consumerDir,
    stdio: 'inherit',
  });

  log('\n[4/5] tsc — type-check the consumer against the SHIPPED .d.ts surface');
  run(path.join(consumerDir, 'node_modules', '.bin', 'tsc'), ['-p', 'tsconfig.json'], {
    cwd: consumerDir,
    stdio: 'inherit',
  });

  log('\n[5/5] running the Mode A/B/C assertions\n');
  run(process.execPath, ['dist/proof.js'], { cwd: consumerDir, stdio: 'inherit' });

  if (keep) {
    log(`\nworking directory kept at ${workdir}`);
  } else {
    fs.rmSync(workdir, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `\nexternal-proof FAILED: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
