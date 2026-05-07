#!/usr/bin/env node

/**
 * Harness check: build output contract inventory.
 *
 * This guards the package output contract before changing build tools.
 * A replacement for tsup must preserve the package.json-facing file names
 * used by consumers and npm publish metadata.
 */

import path from 'node:path';
import { listWorkspaceScopes, readJson, WORKSPACE_ROOT } from './shared.mjs';

const DIST_PATH_PATTERN = /(?:^|\/)dist\//u;
const TYPE_DECLARATION_PATTERN = /\.d\.(?:ts|cts|mts)$/u;
const JAVASCRIPT_OUTPUT_PATTERN = /\.(?:js|cjs|mjs)$/u;
const KNOWN_DIST_OUTPUT_PATTERN = /\.(?:js|cjs|mjs|d\.ts|d\.cts|d\.mts)$/u;

let errors = 0;
let checkedPackages = 0;

function error(message) {
  console.error(`[error] ${message}`);
  errors += 1;
}

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

function hasDistContract(packageJson) {
  const exportedPaths = collectExportPaths(packageJson.exports);
  return (
    typeof packageJson.main === 'string' ||
    typeof packageJson.types === 'string' ||
    exportedPaths.some((exportPath) => DIST_PATH_PATTERN.test(exportPath)) ||
    Boolean(packageJson.bin)
  );
}

function checkScriptPair(scope, packageJson) {
  if (!packageJson.scripts?.build) {
    return;
  }
  if (!hasDistContract(packageJson)) {
    return;
  }
  if (!packageJson.scripts['build:js']) {
    error(`${scope.workspaceName}: missing build:js for root two-pass build`);
  }
  if (!packageJson.scripts['build:types']) {
    error(`${scope.workspaceName}: missing build:types for root two-pass build`);
  }
}

function checkPackageFields(scope, packageJson) {
  if (typeof packageJson.main === 'string' && DIST_PATH_PATTERN.test(packageJson.main)) {
    if (!JAVASCRIPT_OUTPUT_PATTERN.test(packageJson.main)) {
      error(
        `${scope.workspaceName}: main must point at JavaScript output, got ${packageJson.main}`,
      );
    }
  }

  if (typeof packageJson.module === 'string' && DIST_PATH_PATTERN.test(packageJson.module)) {
    if (!JAVASCRIPT_OUTPUT_PATTERN.test(packageJson.module)) {
      error(
        `${scope.workspaceName}: module must point at JavaScript output, got ${packageJson.module}`,
      );
    }
  }

  if (typeof packageJson.types === 'string' && DIST_PATH_PATTERN.test(packageJson.types)) {
    if (!TYPE_DECLARATION_PATTERN.test(packageJson.types)) {
      error(
        `${scope.workspaceName}: types must point at TypeScript declaration output, got ${packageJson.types}`,
      );
    }
  }
}

function checkExportPaths(scope, packageJson) {
  for (const exportPath of collectExportPaths(packageJson.exports)) {
    if (!DIST_PATH_PATTERN.test(exportPath)) {
      continue;
    }
    if (!KNOWN_DIST_OUTPUT_PATTERN.test(exportPath)) {
      error(
        `${scope.workspaceName}: export path has unsupported dist output extension: ${exportPath}`,
      );
    }
  }
}

function checkBinPaths(scope, packageJson) {
  if (!packageJson.bin || typeof packageJson.bin !== 'object') {
    return;
  }
  for (const [binName, binPath] of Object.entries(packageJson.bin)) {
    if (typeof binPath !== 'string') {
      error(`${scope.workspaceName}: bin ${binName} must be a string path`);
      continue;
    }
    if (DIST_PATH_PATTERN.test(binPath) && !JAVASCRIPT_OUTPUT_PATTERN.test(binPath)) {
      error(
        `${scope.workspaceName}: bin ${binName} must point at JavaScript output, got ${binPath}`,
      );
    }
  }
}

const scopes = await listWorkspaceScopes();

for (const scope of scopes.filter((item) => item.kind === 'package')) {
  const packageJson = await readJson(path.join(WORKSPACE_ROOT, scope.relativeDir, 'package.json'));
  if (!hasDistContract(packageJson)) {
    continue;
  }

  checkedPackages += 1;
  checkScriptPair(scope, packageJson);
  checkPackageFields(scope, packageJson);
  checkExportPaths(scope, packageJson);
  checkBinPaths(scope, packageJson);
}

if (errors > 0) {
  console.error(`Build output contract check failed with ${errors} error(s).`);
  process.exit(1);
}

console.log(`Build output contract check passed for ${checkedPackages} package(s).`);
