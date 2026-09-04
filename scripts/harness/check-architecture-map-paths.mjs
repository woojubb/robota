#!/usr/bin/env node

/**
 * Check that `packages/<name>/...` source paths cited in architecture-map docs exist.
 *
 * Guard G1 (architecture audit 2026-06-19, AF-02/04/07 class). `check-spec-paths.mjs`
 * already covers package SPEC.md; this extends the same cited-path existence check to
 * `.agents/specs/architecture-map/**` — the audit found most stale-path drift there
 * (e.g. `agent-transport/src/tui/...` after the transport-package split).
 *
 * Rules:
 * - `packages/<name>/(src|scripts|bin)/....ts` tokens must resolve from the repo root.
 * - A line that ANNOTATES the absence — `(planned)`, `(removed)`, `(deleted)`, `(renamed)`, or the
 *   phrases "no longer" / "does not exist" — is exempt. Narrating a move ("was relocated") is not.
 * - The two historical logs that cite pre-refactor paths on purpose (layering-audit.md,
 *   architecture-lessons.md) are skipped wholesale — see SKIP_FILES.
 *
 * HARNESS-062: the pattern (byte-identical to check-spec-paths') and the exemption vocabulary now
 * come from `cited-paths.mjs`. The local vocabulary was a WIDE negation set that exempted a line on
 * narrative words like "relocated" or "stale", which is why one sentence got three verdicts across
 * the path scans. Measured before replacing it: of the 8 lines in this corpus carrying a cited
 * source path, ZERO were exempted by the wide set — it was live only in the two historical logs
 * this scan skips wholesale, so the narrowing changes nothing here and closes the disagreement.
 *
 * Exit code 0 = clean, 1 = findings.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_SOURCE_PATH_PATTERN, citedRepoPaths } from './cited-paths.mjs';
import { requireGovernedTree } from './governed-tree.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);
const MAP_DIR_RELATIVE = '.agents/specs/architecture-map';

function walkMarkdown(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkMarkdown(full));
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

// Historical audit/lesson logs intentionally cite pre-refactor (now-removed) paths.
const SKIP_FILES = new Set(['layering-audit.md', 'architecture-lessons.md']);

/**
 * How many architecture-map documents the last walk actually READ.
 *
 * A module-level holder rather than a widened return: the finder's shape is asserted by its own
 * cases, and rewriting them to carry a number proves nothing new (HARNESS-057). RESET at the top of
 * the walk, so a run that reads nothing cannot report the previous run's number.
 */
let examinedCount = 0;

export function readExamined() {
  return examinedCount;
}

export async function findArchitectureMapPathFindings(root = WORKSPACE_ROOT) {
  examinedCount = 0;
  requireGovernedTree(root, ['.agents/specs/architecture-map'], {
    scan: 'arch-map-paths',
    why: 'The architecture-map corpus IS this scan\u2019s subject: with no map to read, "every cited path exists" is true of nothing.',
  });
  const findings = [];
  for (const docPath of walkMarkdown(path.join(root, MAP_DIR_RELATIVE))) {
    if (SKIP_FILES.has(path.basename(docPath))) continue;
    const relative = path.relative(root, docPath);
    examinedCount += 1;
    const lines = readFileSync(docPath, 'utf8').split('\n');
    for (const line of lines) {
      for (const token of citedRepoPaths(line, { pattern: REPO_SOURCE_PATH_PATTERN })) {
        if (!existsSync(path.join(root, token))) {
          findings.push({
            file: relative,
            type: 'arch-map-ghost-path',
            detail: `${token} is cited but does not exist in the repository.`,
          });
        }
      }
    }
  }
  return findings;
}

export async function main() {
  const findings = await findArchitectureMapPathFindings(WORKSPACE_ROOT);
  if (findings.length === 0) {
    process.stdout.write(`::examined:: ${examinedCount} architecture-map documents\n`);
    process.stdout.write('architecture-map path scan passed.\n');
    return;
  }
  process.stdout.write('architecture-map path scan failed:\n');
  for (const finding of findings) {
    process.stdout.write(`- [${finding.type}] ${finding.file}: ${finding.detail}\n`);
  }
  process.exitCode = 1;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  await main();
}
