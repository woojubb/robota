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
 * Historical debt: PR #589 (2026-05-25) archived files as implemented while leaving their
 * frontmatter at `todo`. All 17 were reconciled item-by-item by PROC-001 (2026-07-25) — see
 * `.agents/backlog/completed/PROC-001-completed-dir-status-reconciliation.md`. Do not add new
 * entries; the invariant now holds unconditionally.
 */
const LEGACY_COMPLETED_TODO = new Set([]);

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

  findings.push(...(await findDuplicateIdFindings(root)));

  return findings;
}

/**
 * A backlog ID must exist in exactly ONE place. An item filed in the root and separately
 * archived in `completed/` (e.g. the orchestrator files the item, the implementing agent
 * writes its own copy straight into `completed/`) leaves a stale open-looking duplicate that
 * makes finished work read as outstanding. The status⇔directory checks above cannot see this:
 * each file is individually consistent. Observed 2026-07-25 (HARNESS-043).
 */
export async function findDuplicateIdFindings(root = WORKSPACE_ROOT) {
  const findings = [];
  // The ID includes any phase suffix (`-P3`, `-P4-P5`): a phase follow-up filed while its parent
  // is archived (e.g. open `SELFHOST-008-P5-…` alongside completed `SELFHOST-008-…`) is the
  // intended convention, NOT a duplicate — only an identical ID in both places is.
  const idOf = (name) => /^([A-Z]+(?:-[A-Z]+)*-\d+(?:-P\d+)*)/.exec(name)?.[1] ?? null;

  const completedById = new Map();
  for (const name of await listMarkdown(path.join(root, COMPLETED_DIR))) {
    const id = idOf(name);
    if (id !== null) completedById.set(id, name);
  }

  // Within the root, the same ID under two different slugs is always a collision — two authors
  // claimed one number (observed 2026-07-25: concurrent PRs both filed ARCH-006/ARCH-007 from the
  // same audit under different slugs). Phase suffixes are part of the ID, so a legitimate
  // `SELFHOST-008-P5-…` never collides with `SELFHOST-008-…`.
  const rootById = new Map();
  for (const name of await listMarkdown(path.join(root, BACKLOG_DIR))) {
    const id = idOf(name);
    if (id === null) continue;

    const twin = rootById.get(id);
    if (twin === undefined) rootById.set(id, name);
    else {
      findings.push({
        file: path.join(BACKLOG_DIR, name),
        problem: `duplicate backlog ID ${id} — also filed as ${path.join(BACKLOG_DIR, twin)}; one number, one item`,
      });
    }

    const archived = completedById.get(id);
    if (archived === undefined) continue;
    findings.push({
      file: path.join(BACKLOG_DIR, name),
      problem: `duplicate backlog ID ${id} — also archived at ${path.join(COMPLETED_DIR, archived)}; keep exactly one`,
    });
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
