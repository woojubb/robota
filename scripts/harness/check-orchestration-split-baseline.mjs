#!/usr/bin/env node

/**
 * Harness check: orchestration repo split baseline.
 *
 * The split is intentionally blocked while dag-api still carries runtime-level
 * composition dependencies. This check keeps that blocker explicit and fails if
 * new target packages add runtime-level dependencies.
 */

import path from 'node:path';
import { listWorkspaceScopes, readJson, WORKSPACE_ROOT } from './shared.mjs';

const TARGET_PACKAGES = new Set([
  '@robota-sdk/dag-core',
  '@robota-sdk/dag-cost',
  '@robota-sdk/dag-orchestrator',
  '@robota-sdk/dag-api',
  '@robota-sdk/dag-adapters-local',
  '@robota-sdk/dag-orchestration-client',
  '@robota-sdk/dag-designer',
  '@robota-sdk/dag-cli',
  '@robota-sdk/dag-mcp-server',
  '@robota-sdk/dag-orchestrator-server',
  '@robota-sdk/dag-studio',
]);

const FORBIDDEN_RUNTIME_PACKAGES = new Set([
  '@robota-sdk/dag-runtime',
  '@robota-sdk/dag-worker',
  '@robota-sdk/dag-scheduler',
  '@robota-sdk/dag-projection',
  '@robota-sdk/dag-node',
]);

const EXPECTED_BLOCKERS = new Set([
  '@robota-sdk/dag-api -> @robota-sdk/dag-projection',
  '@robota-sdk/dag-api -> @robota-sdk/dag-runtime',
  '@robota-sdk/dag-api -> @robota-sdk/dag-scheduler',
  '@robota-sdk/dag-api -> @robota-sdk/dag-worker',
]);

function listProductionDeps(packageJson) {
  return Object.keys(packageJson.dependencies ?? {}).filter((name) =>
    name.startsWith('@robota-sdk/'),
  );
}

function isForbiddenRuntimePackage(packageName) {
  if (FORBIDDEN_RUNTIME_PACKAGES.has(packageName)) {
    return true;
  }
  return packageName.startsWith('@robota-sdk/dag-node-');
}

function compareSet(left, right) {
  return {
    onlyLeft: [...left].filter((item) => !right.has(item)).sort(),
    onlyRight: [...right].filter((item) => !left.has(item)).sort(),
  };
}

const scopes = await listWorkspaceScopes();
const byName = new Map(scopes.map((scope) => [scope.workspaceName, scope]));
const missingTargets = [...TARGET_PACKAGES].filter((packageName) => !byName.has(packageName));

if (missingTargets.length > 0) {
  console.error(`Missing orchestration split target package(s): ${missingTargets.join(', ')}`);
  process.exit(1);
}

const blockers = new Set();
const unexpectedWorkspaceDeps = [];

for (const packageName of TARGET_PACKAGES) {
  const scope = byName.get(packageName);
  const packageJson = await readJson(path.join(WORKSPACE_ROOT, scope.relativeDir, 'package.json'));
  const productionDeps = listProductionDeps(packageJson);

  for (const dependencyName of productionDeps) {
    if (isForbiddenRuntimePackage(dependencyName)) {
      blockers.add(`${packageName} -> ${dependencyName}`);
      continue;
    }
    if (byName.has(dependencyName) && !TARGET_PACKAGES.has(dependencyName)) {
      unexpectedWorkspaceDeps.push(`${packageName} -> ${dependencyName}`);
    }
  }
}

const { onlyLeft: unexpectedBlockers, onlyRight: resolvedBlockers } = compareSet(
  blockers,
  EXPECTED_BLOCKERS,
);

if (unexpectedWorkspaceDeps.length > 0) {
  console.error('Unexpected workspace dependencies in orchestration split target:');
  for (const dependency of unexpectedWorkspaceDeps) {
    console.error(`  ${dependency}`);
  }
  process.exit(1);
}

if (unexpectedBlockers.length > 0 || resolvedBlockers.length > 0) {
  if (unexpectedBlockers.length > 0) {
    console.error('Unexpected runtime-level blockers:');
    for (const blocker of unexpectedBlockers) {
      console.error(`  ${blocker}`);
    }
  }
  if (resolvedBlockers.length > 0) {
    console.error('Expected blockers were resolved; update this baseline and ORCH-BL-005:');
    for (const blocker of resolvedBlockers) {
      console.error(`  ${blocker}`);
    }
  }
  process.exit(1);
}

console.log(
  `Orchestration split baseline passed with ${EXPECTED_BLOCKERS.size} known dag-api blocker(s).`,
);
