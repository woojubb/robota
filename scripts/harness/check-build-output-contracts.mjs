#!/usr/bin/env node

/**
 * Harness check: build output contract inventory.
 *
 * This guards the package output contract before changing build tools.
 * A replacement for tsup must preserve the package.json-facing file names
 * used by consumers and npm publish metadata.
 */

import fs from 'node:fs';
import path from 'node:path';
import { readArtifactCapability } from '../artifacts/capability.mjs';
import { pinGeneration } from '../artifacts/generation.mjs';
import { ADVISORY_MARKER } from './output-markers.mjs';
import { listWorkspaceScopes, readJson, WORKSPACE_ROOT } from './shared.mjs';

const DIST_PATH_PATTERN = /(?:^|\/)dist\//u;
const TYPE_DECLARATION_PATTERN = /\.d\.(?:ts|cts|mts)$/u;
const CANONICAL_DTS_PATTERN = /\.d\.ts$/u;
const JAVASCRIPT_OUTPUT_PATTERN = /\.(?:js|cjs|mjs)$/u;
const KNOWN_DIST_OUTPUT_PATTERN = /\.(?:js|cjs|mjs|d\.ts|d\.cts|d\.mts)$/u;

function collectExportPaths(value, paths = []) {
  if (typeof value === 'string') {
    paths.push(value);
    return paths;
  }
  if (!value || typeof value !== 'object') {
    return paths;
  }
  for (const nested of Object.values(value)) {
    collectExportPaths(nested, paths);
  }
  return paths;
}

function collectExportTypesPaths(value, paths = []) {
  if (!value || typeof value !== 'object') return paths;
  for (const [key, nested] of Object.entries(value)) {
    if (key === 'types' && typeof nested === 'string') {
      paths.push(nested);
    } else {
      collectExportTypesPaths(nested, paths);
    }
  }
  return paths;
}

export function hasDistContract(packageJson) {
  const exportedPaths = collectExportPaths(packageJson.exports);
  return (
    Boolean(readArtifactCapability(packageJson)) ||
    typeof packageJson.main === 'string' ||
    typeof packageJson.module === 'string' ||
    typeof packageJson.types === 'string' ||
    exportedPaths.some((exportPath) => DIST_PATH_PATTERN.test(exportPath)) ||
    Boolean(packageJson.bin)
  );
}

export function findScriptPairFindings(workspaceName, packageJson) {
  // Compatibility export: the pair is optional; when present it must delegate to complete build.
  if (!readArtifactCapability(packageJson)) return [];
  const findings = [];
  if (!packageJson.scripts?.build)
    findings.push(`${workspaceName}: missing build for managed assembly`);
  for (const alias of ['build:js', 'build:types']) {
    const command = packageJson.scripts?.[alias];
    if (command !== undefined && command !== 'pnpm run build') {
      findings.push(`${workspaceName}: ${alias} must alias complete build with "pnpm run build"`);
    }
  }
  return findings;
}

export function findPackageFieldFindings(workspaceName, packageJson) {
  const findings = [];

  if (typeof packageJson.main === 'string' && DIST_PATH_PATTERN.test(packageJson.main)) {
    if (!JAVASCRIPT_OUTPUT_PATTERN.test(packageJson.main)) {
      findings.push(
        `${workspaceName}: main must point at JavaScript output, got ${packageJson.main}`,
      );
    }
  }

  if (typeof packageJson.module === 'string' && DIST_PATH_PATTERN.test(packageJson.module)) {
    if (!JAVASCRIPT_OUTPUT_PATTERN.test(packageJson.module)) {
      findings.push(
        `${workspaceName}: module must point at JavaScript output, got ${packageJson.module}`,
      );
    }
  }

  if (typeof packageJson.types === 'string' && DIST_PATH_PATTERN.test(packageJson.types)) {
    if (!TYPE_DECLARATION_PATTERN.test(packageJson.types)) {
      findings.push(
        `${workspaceName}: types must point at TypeScript declaration output, got ${packageJson.types}`,
      );
    }
  }

  return findings;
}

export function findExportPathFindings(workspaceName, packageJson) {
  const findings = [];
  for (const exportPath of collectExportPaths(packageJson.exports)) {
    if (!DIST_PATH_PATTERN.test(exportPath)) continue;
    if (!KNOWN_DIST_OUTPUT_PATTERN.test(exportPath)) {
      findings.push(
        `${workspaceName}: export path has unsupported dist output extension: ${exportPath}`,
      );
    }
  }
  return findings;
}

export function findBinPathFindings(workspaceName, packageJson) {
  const findings = [];
  if (!packageJson.bin || typeof packageJson.bin !== 'object') return findings;
  for (const [binName, binPath] of Object.entries(packageJson.bin)) {
    if (typeof binPath !== 'string') {
      findings.push(`${workspaceName}: bin ${binName} must be a string path`);
      continue;
    }
    if (DIST_PATH_PATTERN.test(binPath) && !JAVASCRIPT_OUTPUT_PATTERN.test(binPath)) {
      findings.push(
        `${workspaceName}: bin ${binName} must point at JavaScript output, got ${binPath}`,
      );
    }
  }
  return findings;
}

export function findDtsExtensionFindings(workspaceName, packageJson) {
  const findings = [];

  if (typeof packageJson.types === 'string' && DIST_PATH_PATTERN.test(packageJson.types)) {
    if (
      TYPE_DECLARATION_PATTERN.test(packageJson.types) &&
      !CANONICAL_DTS_PATTERN.test(packageJson.types)
    ) {
      findings.push(
        `${workspaceName}: types="${packageJson.types}" must end with .d.ts (not .d.mts or .d.cts)`,
      );
    }
  }

  for (const typesPath of collectExportTypesPaths(packageJson.exports)) {
    if (
      DIST_PATH_PATTERN.test(typesPath) &&
      TYPE_DECLARATION_PATTERN.test(typesPath) &&
      !CANONICAL_DTS_PATTERN.test(typesPath)
    ) {
      findings.push(
        `${workspaceName}: exports types="${typesPath}" must end with .d.ts (not .d.mts or .d.cts)`,
      );
    }
  }

  return findings;
}

export function findDistFileFindings(
  workspaceName,
  packageJson,
  pkgDir,
  { requireVerifiedGeneration = false } = {},
) {
  const findings = [];
  const distDir = path.join(pkgDir, 'dist');
  const capability = readArtifactCapability(packageJson);
  // lstat distinguishes a genuinely absent output from a dangling/corrupt managed pointer.
  if (!fs.lstatSync(distDir, { throwIfNoEntry: false })) {
    return requireVerifiedGeneration
      ? [`${workspaceName}: verified generation required, dist/ is missing`]
      : [];
  }
  let emittedPaths;
  if (capability || requireVerifiedGeneration) {
    try {
      const generation = pinGeneration(pkgDir);
      emittedPaths = new Set(generation.manifest.files.map((file) => `dist/${file.path}`));
    } catch (error) {
      return [`${workspaceName}: invalid managed generation: ${error.message}`];
    }
  }

  const entries = ['main', 'module', 'types'].map((key) => [key, packageJson[key]]);
  entries.push(...collectExportPaths(packageJson.exports).map((value) => ['exports path', value]));
  entries.push(
    ...(typeof packageJson.bin === 'string'
      ? [['bin', packageJson.bin]]
      : Object.entries(packageJson.bin ?? {}).map(([key, value]) => [`bin.${key}`, value])),
  );
  for (const [label, value] of entries) {
    if (typeof value !== 'string' || !DIST_PATH_PATTERN.test(value)) continue;
    const exists = emittedPaths
      ? emittedPaths.has(value.replace(/^\.\//u, ''))
      : fs.existsSync(path.join(pkgDir, value));
    if (!exists) {
      findings.push(`${workspaceName}: ${label}="${value}" declared but file not found`);
    }
  }

  return findings;
}

export async function findBuildOutputContractFindings(root = WORKSPACE_ROOT, options = {}) {
  const findings = [];
  const scopes = await listWorkspaceScopes(root);

  for (const scope of scopes.filter((item) => item.kind === 'package')) {
    const pkgDir = path.join(root, scope.relativeDir);
    const packageJson = await readJson(path.join(pkgDir, 'package.json'));
    if (!hasDistContract(packageJson)) continue;

    const name = scope.workspaceName;
    findings.push(...findScriptPairFindings(name, packageJson));
    findings.push(...findPackageFieldFindings(name, packageJson));
    findings.push(...findExportPathFindings(name, packageJson));
    findings.push(...findBinPathFindings(name, packageJson));
    findings.push(...findDtsExtensionFindings(name, packageJson));
    findings.push(...findDistFileFindings(name, packageJson, pkgDir, options));
  }

  return findings;
}

/**
 * The pass-line plus, when the dist-file rule could not run everywhere, ONE advisory line.
 *
 * HARNESS-052, reachability axis. `findDistFileFindings` returns `[]` the moment a package has no
 * `dist/` — measured: the same manifest with an EMPTY `dist/` yields two findings — and ci.yml's
 * `quality` job restores `dist` only `if: needs.build.outputs.package_dist_required == 'true'`.
 * Measured through `createVerificationPlan`, that is FALSE for every docs-only, `.agents/**` and
 * `scripts/harness/**` PR, so on those the job's `pnpm harness:scan:build-contracts` step ran the
 * dist-file rule against nothing while printing `Build output contract check passed for N
 * package(s)` — a count of manifests inspected, read as a count of contracts resolved.
 *
 * The pass line now states the count whose `dist/` was actually READ, and the shortfall goes out on
 * `ADVISORY_MARKER` (HARNESS-053), which reaches `pnpm harness:scan`'s summary without touching the
 * verdict. Turning the shortfall into a FAILURE would redden `quality` on every docs-only PR; that
 * is a workflow change (this file cannot restore an artifact) and is recorded, not made here.
 */
export function renderDistCoverage({ checked, distPresent }) {
  const lines = [
    `Build output contract check passed for ${checked} package(s), dist/ read on ${distPresent}.`,
  ];
  if (distPresent < checked) {
    lines.push(
      `${ADVISORY_MARKER} the dist-file rule resolved NOTHING for ${checked - distPresent} of ` +
        `${checked} package(s) with a dist contract — no dist/ on this tree. Declared ` +
        `main/types/exports paths went unverified for them; run \`pnpm build\` first to check them.`,
    );
  }
  return lines;
}

async function main() {
  const options = {
    requireVerifiedGeneration: process.argv.includes('--require-verified-generation'),
  };
  const scopes = await listWorkspaceScopes();
  let checkedPackages = 0;
  let distPresentPackages = 0;
  const findings = [];

  for (const scope of scopes.filter((item) => item.kind === 'package')) {
    const pkgDir = path.join(WORKSPACE_ROOT, scope.relativeDir);
    const packageJson = await readJson(path.join(pkgDir, 'package.json'));
    if (!hasDistContract(packageJson)) continue;

    checkedPackages += 1;
    if (fs.existsSync(path.join(pkgDir, 'dist'))) distPresentPackages += 1;
    const name = scope.workspaceName;
    findings.push(...findScriptPairFindings(name, packageJson));
    findings.push(...findPackageFieldFindings(name, packageJson));
    findings.push(...findExportPathFindings(name, packageJson));
    findings.push(...findBinPathFindings(name, packageJson));
    findings.push(...findDtsExtensionFindings(name, packageJson));
    findings.push(...findDistFileFindings(name, packageJson, pkgDir, options));
  }

  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(`[error] ${finding}`);
    }
    console.error(`Build output contract check failed with ${findings.length} error(s).`);
    process.exit(1);
  }

  // Emitted at the call site, not inside `renderDistCoverage`. The renderer's contract is the
  // VERDICT lines, and a case pins them exactly; the marker is a channel the runner reads, so
  // folding it in there would have made a suite-wide invariant a change to a sentence.
  console.log(`::examined:: ${checkedPackages} packages with a build contract`);

  for (const line of renderDistCoverage({
    checked: checkedPackages,
    distPresent: distPresentPackages,
  })) {
    console.log(line);
  }
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  void main();
}
