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

async function main() {
  const scopes = await listWorkspaceScopes();
  let checkedPackages = 0;
  const findings = [];

  for (const scope of scopes.filter((item) => item.kind === 'package')) {
    const pkgDir = path.join(WORKSPACE_ROOT, scope.relativeDir);
    const packageJson = await readJson(path.join(pkgDir, 'package.json'));
    if (!hasDistContract(packageJson)) continue;

    checkedPackages += 1;
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

  console.log(`Build output contract check passed for ${checkedPackages} package(s).`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
