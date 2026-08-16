#!/usr/bin/env node

/**
 * INFRA-102 — the Node version must be SINGLE-VALUED across the workspace.
 *
 * The defect this exists to catch: version selection was a function of the working
 * directory. The root `package.json` carried the only `volta` pin, Volta resolves from the
 * NEAREST manifest, and `pnpm test` is `pnpm run -r --if-present test` — which runs every
 * workspace with that package as cwd. So the declared pin bound for none of them, and 58
 * packages tested on an undeclared runtime. Only `dag-adapters-sqlite` showed it, because an
 * ABI mismatch is the one failure mode loud enough to notice (`NODE_MODULE_VERSION 127` vs
 * `137`); every pure-TypeScript package was equally unpinned and silent.
 *
 * Two edges, because the declaration and the reality are different claims and the whole
 * point of this item is that they had drifted:
 *
 *   DECLARED (`--declared`, default) — every workspace manifest resolves to the root pin,
 *   either by its own `volta.node` or by a `volta.extends` whose target actually exists and
 *   actually carries the pin. A manifest with neither is what made the pin directory-
 *   dependent in the first place. This edge is hermetic and runs in CI.
 *
 *   MEASURED (`--measured`) — the runtime a workspace script ACTUALLY receives equals the
 *   declared one. This is deliberately separate: a manifest edit cannot make it true.
 *   Volta binds a package tool (`pnpm`) to the Node it was installed against rather than to
 *   the project pin (volta-cli/volta#1562, #2072), so on a host whose Volta default is not
 *   the pinned version, `pnpm exec node` reports the default while a bare `node` reports the
 *   pin. Reporting only the declared edge would be the exact defect this item removes — a
 *   green that does not mean what its reader thinks.
 *
 * Exit code 0 = clean, 1 = findings.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

import { requireGovernedTree } from './governed-tree.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const ROOT_MANIFEST = path.join(WORKSPACE_ROOT, 'package.json');
const WORKSPACE_DIRS = ['packages', 'apps'];

/** The one place the version literal is allowed to live. */
export function readRootPin(rootManifestPath = ROOT_MANIFEST) {
  const manifest = JSON.parse(readFileSync(rootManifestPath, 'utf8'));
  return manifest.volta?.node;
}

/** Every workspace manifest path, relative to the workspace root. */
export function listWorkspaceManifests(root = WORKSPACE_ROOT) {
  const manifests = [];
  for (const dir of WORKSPACE_DIRS) {
    const absolute = path.join(root, dir);
    if (!existsSync(absolute)) continue;
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifest = path.join(dir, entry.name, 'package.json');
      if (existsSync(path.join(root, manifest))) manifests.push(manifest);
    }
  }
  return manifests.sort();
}

/**
 * Does this manifest resolve to a Node pin? Returns the resolved version, or a reason it
 * does not resolve. `extends` is followed, so the version literal stays single-valued.
 */
export function resolveManifestPin(root, manifestRelative, seen = new Set()) {
  const absolute = path.join(root, manifestRelative);
  if (seen.has(absolute)) return { ok: false, reason: 'circular `volta.extends` chain' };
  seen.add(absolute);

  if (!existsSync(absolute))
    return { ok: false, reason: `manifest not found: ${manifestRelative}` };
  const volta = JSON.parse(readFileSync(absolute, 'utf8')).volta;
  if (!volta) return { ok: false, reason: 'no `volta` field — Volta falls through to its default' };
  if (typeof volta.node === 'string') return { ok: true, version: volta.node };
  if (typeof volta.extends !== 'string') {
    return { ok: false, reason: '`volta` field carries neither `node` nor `extends`' };
  }

  const target = path.resolve(path.dirname(absolute), volta.extends);
  if (!existsSync(target)) {
    return { ok: false, reason: `\`volta.extends\` points at a missing file: ${volta.extends}` };
  }
  return resolveManifestPin(root, path.relative(root, target), seen);
}

/**
 * The declared edge's examined-size, as an output a test can read (measurement-provenance.md).
 * Deriving it from the same listing the scan walks is the point: a reader that recounted
 * independently could agree with the printed number while both were wrong about the subject.
 */
export function readExaminedManifestCount(root = WORKSPACE_ROOT) {
  return listWorkspaceManifests(root).length;
}

/** DECLARED edge — hermetic, CI-safe. */
export function findDeclaredPinFindings(root = WORKSPACE_ROOT) {
  // HARNESS-052: a workspace with no manifests to read is a broken root, not a clean one. Without
  // this, pointing the scan at the wrong directory reports "single-valued" over nothing at all —
  // the same vacuous green this item exists to remove, one level up.
  requireGovernedTree(root, ['package.json', 'packages'], {
    scan: 'node-version-single-valued',
    why: 'the Node pin is judged by comparing every workspace manifest to the root declaration; with no root manifest or no workspace tree there is nothing to compare and a pass would mean nothing',
  });
  const rootPin = readRootPin(path.join(root, 'package.json'));
  const findings = [];
  if (typeof rootPin !== 'string') {
    findings.push({ file: 'package.json', problem: 'root manifest declares no `volta.node` pin' });
    return { findings, examined: 0, rootPin };
  }
  const manifests = listWorkspaceManifests(root);
  for (const manifest of manifests) {
    const resolved = resolveManifestPin(root, manifest);
    if (!resolved.ok) {
      findings.push({ file: manifest, problem: resolved.reason });
      continue;
    }
    if (resolved.version !== rootPin) {
      findings.push({
        file: manifest,
        problem: `resolves to node ${resolved.version}, but the root declares ${rootPin} — the version must be single-valued`,
      });
    }
  }
  return { findings, examined: manifests.length, rootPin };
}

/**
 * MEASURED edge — asks the toolchain what a workspace script would actually run on.
 * Never hermetic: it depends on host Volta state, which is why it is opt-in.
 */
export function findMeasuredRuntimeFindings(root = WORKSPACE_ROOT) {
  requireGovernedTree(root, ['package.json', 'packages'], {
    scan: 'node-version-single-valued --measured',
    why: 'the measured edge probes the runtime a WORKSPACE script receives; without a workspace tree there is no such script and a pass would describe nothing',
  });
  const rootPin = readRootPin(path.join(root, 'package.json'));
  const probe = 'process.stdout.write(process.version.replace(/^v/, ""))';
  const read = (command, args, cwd) => {
    try {
      return execFileSync(command, args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
    } catch {
      return null;
    }
  };

  const findings = [];
  const sample = listWorkspaceManifests(root)[0];
  const sampleDir = sample ? path.join(root, path.dirname(sample)) : root;

  const bare = read('node', ['-e', probe], sampleDir);
  if (bare && bare !== rootPin) {
    findings.push({
      file: path.dirname(sample ?? 'package.json'),
      problem: `\`node\` in a workspace directory runs ${bare}, but the root declares ${rootPin}`,
    });
  }

  const viaPackageManager = read('pnpm', ['exec', 'node', '-e', probe], sampleDir);
  if (viaPackageManager && viaPackageManager !== rootPin) {
    findings.push({
      file: 'package.json',
      problem:
        `\`pnpm exec node\` runs ${viaPackageManager}, but the root declares ${rootPin}. ` +
        'Volta binds a package tool to the Node it was installed against, not to the project pin ' +
        '(volta-cli/volta#1562). Remediate on the host: `volta install node@' +
        `${rootPin}\` to make it the default, then reinstall the package manager so it rebinds.`,
    });
  }
  return { findings, examined: viaPackageManager === null ? 1 : 2 };
}

function main() {
  const measured = process.argv.includes('--measured');
  const { findings, examined, rootPin } = measured
    ? findMeasuredRuntimeFindings()
    : findDeclaredPinFindings();

  if (measured) {
    process.stdout.write(`::examined:: ${examined} runtime probe(s)\n`);
  } else {
    process.stdout.write(
      `::examined:: ${examined} workspace manifest(s) against root pin ${rootPin}\n`,
    );
  }

  if (findings.length === 0) {
    process.stdout.write(`node-version-single-valued scan passed.\n`);
    return 0;
  }
  process.stderr.write(
    'node-version-single-valued scan failed — the Node version is not single-valued:\n',
  );
  for (const finding of findings) {
    process.stderr.write(`  - ${finding.file}: ${finding.problem}\n`);
  }
  return 1;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  process.exit(main());
}
