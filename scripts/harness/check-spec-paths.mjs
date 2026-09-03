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
 * The patterns and the exemption vocabulary come from `cited-paths.mjs` (HARNESS-062) — this scan
 * used to carry its own copy of both. It stays on the STRICT `PLANNED_ONLY_VOCABULARY` on purpose:
 * a package SPEC is the contract for what the package IS, not a changelog, so a SPEC line saying a
 * module "was removed" should be deleted rather than exempted. That strictness is now a named
 * option instead of a fork.
 *
 * Exit code 0 = clean, 1 = findings.
 */

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import {
  LOCAL_SOURCE_PATH_PATTERN,
  PLANNED_ONLY_VOCABULARY,
  REPO_SOURCE_PATH_PATTERN,
  citedRepoPaths,
} from './cited-paths.mjs';
import { listSpecPackageDirs } from './workspace-packages.mjs';
import { requireGovernedTree } from './governed-tree.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);

const LOCAL_CITATION = {
  pattern: LOCAL_SOURCE_PATH_PATTERN,
  vocabulary: PLANNED_ONLY_VOCABULARY,
};
const REPO_CITATION = {
  pattern: REPO_SOURCE_PATH_PATTERN,
  vocabulary: PLANNED_ONLY_VOCABULARY,
};

function listSpecFiles(root) {
  // Nesting-aware: covers depth-1 packages and nested group members (e.g. packages/dag-nodes/<name>).
  return listSpecPackageDirs(root).map((packageDir) => ({
    packageDir,
    specPath: path.join(packageDir, 'docs', 'SPEC.md'),
  }));
}

/**
 * How many specification documents the last walk actually READ.
 *
 * A module-level holder rather than a widened return: the finder's shape is asserted by its own
 * cases, and rewriting them to carry a number proves nothing new (HARNESS-057). RESET at the top of
 * the walk, so a run that reads nothing cannot report the previous run's number.
 */
let examinedCount = 0;

export function readExamined() {
  return examinedCount;
}

export async function findSpecPathFindings(root = WORKSPACE_ROOT) {
  examinedCount = 0;
  requireGovernedTree(root, ['packages'], {
    scan: 'spec-paths',
    why: 'It validates the paths cited by package SPECs; with no packages/ there are no SPECs and the pass means nothing was read.',
  });
  const findings = [];

  for (const { packageDir, specPath } of listSpecFiles(root)) {
    const relativeSpec = path.relative(root, specPath);
    examinedCount += 1;
    const lines = readFileSync(specPath, 'utf8').split('\n');

    for (const line of lines) {
      for (const token of citedRepoPaths(line, LOCAL_CITATION)) {
        if (!existsSync(path.join(packageDir, token))) {
          findings.push({
            file: relativeSpec,
            type: 'spec-ghost-path',
            detail: `${token} is referenced but does not exist in ${path.relative(root, packageDir)}.`,
          });
        }
      }

      for (const token of citedRepoPaths(line, REPO_CITATION)) {
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
    process.stdout.write(`::examined:: ${examinedCount} specification documents\n`);
    process.stdout.write('spec path scan passed.\n');
    return;
  }
  process.stdout.write('spec path scan failed:\n');
  for (const finding of findings) {
    process.stdout.write(`- [${finding.type}] ${finding.file}: ${finding.detail}\n`);
  }
  process.exitCode = 1;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  await main();
}
