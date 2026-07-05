#!/usr/bin/env node

/**
 * Backlog placement invariant scan (lesson 2026-07-02).
 *
 * `.agents/rules/backlog-execution.md` § Status Invariants has long required that a terminal-status
 * backlog file (`done`/`wontfix`/`skipped`/`superseded`) lives in `.agents/backlog/completed/` and an
 * open file (`todo`/`in-progress`) lives in the root — but the invariant existed only as prose, and
 * 8 `status: done` files were found sitting in the root (their status was flipped when the work
 * shipped, the move was skipped, and nothing failed). Prose without a mechanism does not hold.
 *
 * Findings:
 *   - a root `.agents/backlog/*.md` file with a terminal `status:` → must be moved to `completed/`
 *   - a `completed/*.md` file with an open `status:` → must be reopened (moved back) or closed
 *   - a root file with `status: done` and no `completed:` date → record the completion date
 *
 * Exit code 0 = invariants hold, 1 = placement drift found.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const BACKLOG_DIR = '.agents/backlog';
const COMPLETED_DIR = '.agents/backlog/completed';

const TERMINAL_STATUSES = new Set(['done', 'wontfix', 'skipped', 'superseded']);
const OPEN_STATUSES = new Set(['todo', 'in-progress']);

/**
 * Historical debt: PR #589 (2026-05-25) archived these as implemented but never flipped their
 * frontmatter from `todo`. Their true state needs item-by-item verification — tracked by
 * `.agents/backlog/PROC-001-completed-dir-status-reconciliation.md`. Do not add new entries.
 */
const LEGACY_COMPLETED_TODO = new Set([
  '.agents/backlog/completed/CLI-032-git-first-class-commands.md',
  '.agents/backlog/completed/CLI-034-plugin-publish-one-official.md',
  '.agents/backlog/completed/CLI-042-grep-tool-parallel.md',
  '.agents/backlog/completed/CLI-043-glob-stat-n-plus-one.md',
  '.agents/backlog/completed/CLI-044-process-exit-cleanup.md',
  '.agents/backlog/completed/CLI-046-denied-tools-flag.md',
  '.agents/backlog/completed/CLI-047-structured-exit-codes.md',
  '.agents/backlog/completed/CLI-048-websearch-fallback.md',
  '.agents/backlog/completed/PM-026-github-action-official.md',
  '.agents/backlog/completed/PM-027-korean-marketing-content.md',
  '.agents/backlog/completed/PM-028-beta-invite-program.md',
  '.agents/backlog/completed/PM-029-sdk-starter-kit.md',
  '.agents/backlog/completed/PM-030-opt-in-telemetry.md',
  '.agents/backlog/completed/PM-031-readme-demo-gif.md',
  '.agents/backlog/completed/PM-033-init-inline-provider-setup.md',
  '.agents/backlog/completed/PM-034-help-command-examples.md',
  '.agents/backlog/completed/SITE-004-domain-redirect-migration.md',
]);

/** @returns {{ status: string | null, hasCompletedDate: boolean }} */
export function readBacklogFrontmatter(content) {
  const statusMatch = /^status:\s*(\S+)/m.exec(content);
  const completedMatch = /^completed:\s*\S+/m.exec(content);
  return {
    status: statusMatch ? statusMatch[1] : null,
    hasCompletedDate: completedMatch !== null,
  };
}

async function listMarkdown(dirAbsolute) {
  try {
    const entries = await fs.readdir(dirAbsolute);
    return entries.filter((name) => name.endsWith('.md') && name !== 'README.md').sort();
  } catch {
    return [];
  }
}

export async function findBacklogPlacementFindings(root = WORKSPACE_ROOT) {
  const findings = [];

  for (const name of await listMarkdown(path.join(root, BACKLOG_DIR))) {
    const relative = path.join(BACKLOG_DIR, name);
    if (relative.startsWith(COMPLETED_DIR)) continue;
    const stat = await fs.stat(path.join(root, relative));
    if (stat.isDirectory()) continue;
    const { status, hasCompletedDate } = readBacklogFrontmatter(
      await fs.readFile(path.join(root, relative), 'utf8'),
    );
    if (status === null) continue;
    if (TERMINAL_STATUSES.has(status)) {
      findings.push({
        file: relative,
        problem: `terminal status "${status}" but still in the backlog root — git mv to completed/`,
      });
      if (status === 'done' && !hasCompletedDate) {
        findings.push({
          file: relative,
          problem: 'status: done without a completed: YYYY-MM-DD frontmatter date',
        });
      }
    }
  }

  for (const name of await listMarkdown(path.join(root, COMPLETED_DIR))) {
    const relative = path.join(COMPLETED_DIR, name);
    if (LEGACY_COMPLETED_TODO.has(relative)) continue;
    const { status } = readBacklogFrontmatter(await fs.readFile(path.join(root, relative), 'utf8'));
    if (status !== null && OPEN_STATUSES.has(status)) {
      findings.push({
        file: relative,
        problem: `open status "${status}" inside completed/ — reopen (move back) or close it`,
      });
    }
  }

  return findings;
}

export async function main() {
  const findings = await findBacklogPlacementFindings(WORKSPACE_ROOT);

  if (findings.length === 0) {
    process.stdout.write('backlog-placement scan passed.\n');
    return;
  }

  process.stdout.write('backlog-placement scan failed — status/location invariant violations:\n');
  for (const finding of findings) {
    process.stdout.write(`  - ${finding.file}: ${finding.problem}\n`);
  }
  process.stdout.write(
    'Per backlog-execution.md Completion Steps: set the terminal status + completed: date and ' +
      'git mv to .agents/backlog/completed/ in the SAME commit as the closing work.\n',
  );
  process.exitCode = 1;
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isDirectExecution) {
  await main();
}
