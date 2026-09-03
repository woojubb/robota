#!/usr/bin/env node

/**
 * Harness config ghost-path scan (LESSON-006).
 *
 * Harness scan scripts hardcode workspace file paths in their config (e.g.
 * `file: 'packages/agent-transport-tui/src/TuiInteractionChannel.ts'`). When a
 * package or file is relocated, those literals go stale and the dependent scan
 * silently checks a path that no longer exists — exactly what happened during
 * the DQ-AUDIT-004/005 relocations (hardcoded tui paths failed several scans,
 * 2026-06-14).
 *
 * This meta-scan reads every `scripts/harness/*.mjs` and verifies that quoted
 * string literals that look like workspace file paths (packages/|apps/|scripts/
 * root, a file extension, no globs) resolve from the repository root. Comment
 * lines and lines marked `(planned)` are exempt.
 *
 * Legitimate non-existent references — forbidden-path / negative assertions and
 * fixture paths built under a temp dir — are exempt via a marker comment
 * `harness-config-path-allow-missing` on the same line or the line directly
 * above (mirrors the done-evidence `evidence-superseded` convention). A future
 * stale path is still caught unless explicitly annotated.
 *
 * Exit code 0 = clean, 1 = ghost paths found.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  PLANNED_ONLY_VOCABULARY,
  QUOTED_REPO_FILE_PATH_PATTERN,
  citedRepoPaths,
} from './cited-paths.mjs';
import { requireGovernedTree } from './governed-tree.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);
const HARNESS_DIR = path.join(WORKSPACE_ROOT, 'scripts', 'harness');

const ALLOW_MISSING_MARKER = 'harness-config-path-allow-missing';

// STRICT on purpose (HARNESS-062): a scan's hardcoded path literal is configuration, not prose —
// there is no sentence it could be part of that would excuse it pointing nowhere. Its escape hatch
// is the explicit ALLOW_MISSING_MARKER, so the vocabulary stays at `(planned)`-only rather than
// adopting the shared absence set.
const QUOTED_CITATION = {
  pattern: QUOTED_REPO_FILE_PATH_PATTERN,
  vocabulary: PLANNED_ONLY_VOCABULARY,
};

function isCommentLine(line) {
  const t = line.trim();
  return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') || t.startsWith('#');
}

function listHarnessScripts(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.mjs'))
    .map((e) => path.join(dir, e.name));
}

export function findHarnessConfigPathFindings(root = WORKSPACE_ROOT) {
  requireGovernedTree(root, ['scripts/harness'], {
    scan: 'harness-config-paths',
    why: 'The harness scripts are the documents whose quoted paths this scan validates.',
  });
  const findings = [];

  for (const scriptPath of listHarnessScripts(path.join(root, 'scripts', 'harness'))) {
    const relativeScript = path.relative(root, scriptPath);
    const lines = readFileSync(scriptPath, 'utf8').split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (isCommentLine(line)) continue;
      const allowMissing =
        line.includes(ALLOW_MISSING_MARKER) ||
        (i > 0 && lines[i - 1].includes(ALLOW_MISSING_MARKER));
      if (allowMissing) continue;

      for (const token of citedRepoPaths(line, QUOTED_CITATION)) {
        if (!existsSync(path.join(root, token))) {
          findings.push({
            file: relativeScript,
            line: i + 1,
            token,
          });
        }
      }
    }
  }

  return findings;
}

export function main() {
  // Touch HARNESS_DIR so the constant is meaningful even if the list is empty.
  void HARNESS_DIR;
  const findings = findHarnessConfigPathFindings(WORKSPACE_ROOT);
  if (findings.length === 0) {
    process.stdout.write('harness config path scan passed.\n');
    return;
  }
  process.stdout.write('harness config path scan failed — stale hardcoded paths:\n');
  for (const finding of findings) {
    process.stdout.write(`  - ${finding.file}:${finding.line} → ${finding.token}\n`);
  }
  process.stdout.write(
    'Update the hardcoded path after a relocation, or derive the package list dynamically.\n',
  );
  process.exitCode = 1;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main();
}
