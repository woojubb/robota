#!/usr/bin/env node

/**
 * Verify package-level test coverage command availability.
 *
 * This is a static harness check. It does not run coverage, so it can remain
 * cheap enough for harness:scan while keeping expensive coverage execution
 * explicit and opt-in.
 */

import path from 'node:path';

import { listWorkspaceScopes, readJson } from './shared.mjs';

const ROOT_PACKAGE_JSON_PATH = path.join(process.cwd(), 'package.json');

const REQUIRED_ROOT_COVERAGE_SCRIPTS = [
  'test:coverage',
  'test:coverage:packages',
  'test:coverage:apps',
];

export function isCoverageScriptRequired(scope) {
  const testScript = scope.scripts?.test;
  if (typeof testScript !== 'string') {
    return false;
  }
  return /\b(vitest|jest)\b/.test(testScript);
}

export function findCoverageScriptFindings(scopes) {
  return scopes.flatMap((scope) => {
    if (!isCoverageScriptRequired(scope)) {
      return [];
    }
    if (typeof scope.scripts?.['test:coverage'] === 'string') {
      return [];
    }
    return [
      {
        file: path.posix.join(scope.relativeDir, 'package.json'),
        type: 'missing-test-coverage-script',
        detail: `${scope.workspaceName} exposes test but does not expose a package-level test:coverage script.`,
      },
    ];
  });
}

export function findRootCoverageScriptFindings(packageJson) {
  const scripts =
    typeof packageJson.scripts === 'object' && packageJson.scripts !== null
      ? packageJson.scripts
      : {};
  const findings = [];

  for (const scriptName of REQUIRED_ROOT_COVERAGE_SCRIPTS) {
    if (typeof scripts[scriptName] !== 'string') {
      findings.push({
        file: 'package.json',
        type: 'missing-root-coverage-script',
        detail: `Root package.json must expose ${scriptName}.`,
      });
    }
  }

  if (typeof scripts['harness:scan:coverage-scripts'] !== 'string') {
    findings.push({
      file: 'package.json',
      type: 'missing-root-harness-script',
      detail: 'Root package.json must expose harness:scan:coverage-scripts.',
    });
  }

  const harnessScan = scripts['harness:scan'];
  if (typeof harnessScan !== 'string' || !harnessScan.includes('harness:scan:coverage-scripts')) {
    findings.push({
      file: 'package.json',
      type: 'coverage-scan-not-wired',
      detail: 'Root harness:scan must include harness:scan:coverage-scripts.',
    });
  }

  return findings;
}

async function main() {
  const [rootPackageJson, scopes] = await Promise.all([
    readJson(ROOT_PACKAGE_JSON_PATH),
    listWorkspaceScopes(),
  ]);
  const findings = [
    ...findRootCoverageScriptFindings(rootPackageJson),
    ...findCoverageScriptFindings(scopes),
  ];

  if (findings.length > 0) {
    console.error('test coverage script scan failed:');
    for (const finding of findings) {
      console.error(`- [${finding.type}] ${finding.file}: ${finding.detail}`);
    }
    process.exit(1);
  }

  console.log('test coverage script scan passed.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
