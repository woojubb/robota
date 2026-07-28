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
import { pathToFileURL } from 'node:url';
import { ADVISORY_MARKER } from './run-all-scans.mjs';
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
    typeof packageJson.main === 'string' ||
    typeof packageJson.types === 'string' ||
    exportedPaths.some((exportPath) => DIST_PATH_PATTERN.test(exportPath)) ||
    Boolean(packageJson.bin)
  );
}

export function findScriptPairFindings(workspaceName, packageJson) {
  if (!packageJson.scripts?.build) return [];
  if (!hasDistContract(packageJson)) return [];
  const findings = [];
  if (!packageJson.scripts['build:js']) {
    findings.push(`${workspaceName}: missing build:js for root two-pass build`);
  }
  if (!packageJson.scripts['build:types']) {
    findings.push(`${workspaceName}: missing build:types for root two-pass build`);
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

export function findDistFileFindings(workspaceName, packageJson, pkgDir) {
  const findings = [];
  const distDir = path.join(pkgDir, 'dist');
  if (!fs.existsSync(distDir)) return findings;

  if (typeof packageJson.main === 'string' && DIST_PATH_PATTERN.test(packageJson.main)) {
    if (!fs.existsSync(path.join(pkgDir, packageJson.main))) {
      findings.push(`${workspaceName}: main="${packageJson.main}" declared but file not found`);
    }
  }

  if (typeof packageJson.types === 'string' && DIST_PATH_PATTERN.test(packageJson.types)) {
    if (!fs.existsSync(path.join(pkgDir, packageJson.types))) {
      findings.push(`${workspaceName}: types="${packageJson.types}" declared but file not found`);
    }
  }

  if (packageJson.exports && typeof packageJson.exports === 'object') {
    for (const exportPath of collectExportPaths(packageJson.exports)) {
      if (!DIST_PATH_PATTERN.test(exportPath)) continue;
      if (!fs.existsSync(path.join(pkgDir, exportPath))) {
        findings.push(`${workspaceName}: exports path "${exportPath}" declared but file not found`);
      }
    }
  }

  return findings;
}

export async function findBuildOutputContractFindings(root = WORKSPACE_ROOT) {
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
    findings.push(...findDistFileFindings(name, packageJson, pkgDir));
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
    findings.push(...findDistFileFindings(name, packageJson, pkgDir));
  }

  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(`[error] ${finding}`);
    }
    console.error(`Build output contract check failed with ${findings.length} error(s).`);
    process.exit(1);
  }

  for (const line of renderDistCoverage({
    checked: checkedPackages,
    distPresent: distPresentPackages,
  })) {
    console.log(line);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
