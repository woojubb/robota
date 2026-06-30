#!/usr/bin/env node

/**
 * Check that source paths referenced in package SPEC.md files exist.
 *
 * Lesson source: agent-cli SPEC referenced seven deleted startup modules for
 * weeks after the ARCH-002 refactor (HARNESS-003, 2026-06-11).
 *
 * Rules:
 * - `src/**` tokens in packages/<name>/docs/SPEC.md must resolve inside that package.
 * - `packages/<name>/...` tokens must resolve from the repository root.
 * - Lines containing `(planned)` are exempt.
 *
 * Exit code 0 = clean, 1 = findings.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { listSpecPackageDirs } from './workspace-packages.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

const LOCAL_PATH_PATTERN = /(?<![\w/])src\/[\w\-./]+\.(?:tsx|ts|mjs|cjs)(?!\w)/g;
const REPO_PATH_PATTERN =
  /packages\/[\w-]+\/(?:src|scripts|bin)\/[\w\-./]+\.(?:tsx|ts|mjs|cjs)(?!\w)/g;

function listSpecFiles(root) {
  // Nesting-aware: covers depth-1 packages and nested group members (e.g. packages/dag-nodes/<name>).
  return listSpecPackageDirs(root).map((packageDir) => ({
    packageDir,
    specPath: path.join(packageDir, 'docs', 'SPEC.md'),
  }));
}

export async function findSpecPathFindings(root = WORKSPACE_ROOT) {
  const findings = [];

  for (const { packageDir, specPath } of listSpecFiles(root)) {
    const relativeSpec = path.relative(root, specPath);
    const lines = readFileSync(specPath, 'utf8').split('\n');

    for (const line of lines) {
      if (line.includes('(planned)')) continue;

      for (const match of line.matchAll(LOCAL_PATH_PATTERN)) {
        const token = match[0];
        if (!existsSync(path.join(packageDir, token))) {
          findings.push({
            file: relativeSpec,
            type: 'spec-ghost-path',
            detail: `${token} is referenced but does not exist in ${path.relative(root, packageDir)}.`,
          });
        }
      }

      for (const match of line.matchAll(REPO_PATH_PATTERN)) {
        const token = match[0];
        if (!existsSync(path.join(root, token))) {
          findings.push({
            file: relativeSpec,
            type: 'spec-ghost-path',
            detail: `${token} is referenced but does not exist in the repository.`,
          });
        }
      }
    }
  }

  return findings;
}

export async function main() {
  const findings = await findSpecPathFindings(WORKSPACE_ROOT);
  if (findings.length === 0) {
    process.stdout.write('spec path scan passed.\n');
    return;
  }
  process.stdout.write('spec path scan failed:\n');
  for (const finding of findings) {
    process.stdout.write(`- [${finding.type}] ${finding.file}: ${finding.detail}\n`);
  }
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
