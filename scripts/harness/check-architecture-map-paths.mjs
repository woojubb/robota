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
 * - Lines that deliberately reference an absent/removed path are exempt (these docs —
 *   layering-audit.md, architecture-lessons.md — document removals on purpose).
 *
 * Exit code 0 = clean, 1 = findings.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const MAP_DIR = path.join(WORKSPACE_ROOT, '.agents/specs/architecture-map');

const REPO_PATH_PATTERN =
  /packages\/[\w-]+\/(?:src|scripts|bin)\/[\w\-./]+\.(?:tsx|ts|mjs|cjs)(?!\w)/g;

// Lines that intentionally point at a path that does NOT exist (removal/absence docs).
const NEGATION =
  /\b(absent|removed|deleted|no longer|does not exist|doesn't exist|nonexistent|non-existent|stale|moved to|relocated|renamed|migrated|MISSING|was extracted|\(planned\))\b/i;

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

export async function findArchitectureMapPathFindings(root = WORKSPACE_ROOT) {
  const findings = [];
  for (const docPath of walkMarkdown(MAP_DIR)) {
    if (SKIP_FILES.has(path.basename(docPath))) continue;
    const relative = path.relative(root, docPath);
    const lines = readFileSync(docPath, 'utf8').split('\n');
    for (const line of lines) {
      if (NEGATION.test(line)) continue;
      for (const match of line.matchAll(REPO_PATH_PATTERN)) {
        const token = match[0];
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
    process.stdout.write('architecture-map path scan passed.\n');
    return;
  }
  process.stdout.write('architecture-map path scan failed:\n');
  for (const finding of findings) {
    process.stdout.write(`- [${finding.type}] ${finding.file}: ${finding.detail}\n`);
  }
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
