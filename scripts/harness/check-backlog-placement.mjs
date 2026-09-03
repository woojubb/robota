#!/usr/bin/env node

/**
 * Backlog placement invariant scan (lesson 2026-07-02).
 *
 * `.agents/rules/backlog-execution.md` § Status Invariants has long required that a terminal-status
 * backlog file (`done`/`wontfix`/`skipped`/`superseded`) lives in `.agents/tasks/completed/` and an
 * open file (`todo`/`in-progress`) lives in the root — but the invariant existed only as prose, and
 * 8 `status: done` files were found sitting in the root (their status was flipped when the work
 * shipped, the move was skipped, and nothing failed). Prose without a mechanism does not hold.
 *
 * Findings:
 *   - a root `.agents/tasks/*.md` file with a terminal `status:` → must be moved to `completed/`
 *   - a `completed/*.md` file with an open `status:` → must be reopened (moved back) or closed
 *   - a root file with `status: done` and no `completed:` date → record the completion date
 *
 * Exit code 0 = invariants hold, 1 = placement drift found.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { requireGovernedTree } from './governed-tree.mjs';
import {
  OPEN_TASK_STATUSES,
  TERMINAL_TASK_STATUSES,
  classifyTaskLifecycle,
} from './task-lifecycle.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);
const BACKLOG_DIR = '.agents/tasks';
const COMPLETED_DIR = '.agents/tasks/completed';
const SPEC_DOCS_DIR = '.agents/spec-docs';
const LEGACY_LIFECYCLE_BASELINE = 'scripts/harness/task-lifecycle-legacy-baseline.json';

/** The leading ID token of a backlog/spec filename, phase suffix included (`SELFHOST-008-P5`). */
export const idOf = (name) => /^([A-Z]+(?:-[A-Z]+)*-\d+(?:-P\d+)*)/.exec(name)?.[1] ?? null;

/**
 * Historical debt: PR #589 (2026-05-25) archived files as implemented while leaving their
 * frontmatter at `todo`. All 17 were reconciled item-by-item by PROC-001 (2026-07-25) — see
 * `.agents/tasks/completed/PROC-001-completed-dir-status-reconciliation.md`. Do not add new
 * entries; the invariant now holds unconditionally.
 */
const LEGACY_COMPLETED_TODO = new Set([]);

/**
 * The status a task file declares, read from its FRONTMATTER.
 *
 * The reader was `/^status:\s*(\S+)/m` over the WHOLE document, so a file with no `---` block at
 * all still answered with whatever its prose happened to say — and answered authoritatively, since
 * every placement rule below trusts it. A case written to prove the missing-frontmatter finding
 * measured it instead: a body line reading `status: done` came back as a terminal status in the
 * wrong directory rather than as a file with no frontmatter.
 *
 * `README.md` says grep-based tooling relies EXCLUSIVELY on frontmatter for status tracking, and
 * bans a `## Status` body section outright. This function is that tooling; reading the body was the
 * claim and the code disagreeing.
 *
 * It parses through `parseFrontmatterBlock`, which declares itself the owner of the `^<key>:` line
 * regex for the whole harness. A private block regex here would be a second answer to "where does
 * frontmatter start and end", which is the fork this repository already has a guard against.
 *
 * @returns {{ status: string | null, hasCompletedDate: boolean }}
 */
export function readBacklogFrontmatter(content) {
  const lifecycle = classifyTaskLifecycle(content);
  return {
    status: lifecycle.status,
    hasCompletedDate: lifecycle.completed !== null,
  };
}

/**
 * What a file with no readable `status:` is told, in BOTH halves of the tree.
 *
 * One spelling because it is one rule. Review found the missing-frontmatter finding added to the
 * root loop and not to the `completed/` loop one screen down, so an archived file with its status
 * in the body stayed silent — a class closed on one side and left open on the other.
 */
// RETROACTIVE, deliberately, and the sweep is on record rather than assumed: when the reader was
// made honest (frontmatter-only), the full corpus — 831 task files, root and completed/ — was run
// through this scan in the same change. Exactly nine violations existed (`completed/ARCH-002-p15`
// through `-p23`, status in a banned `## Status` body section) and all nine were repaired in that
// change. There is NO baseline here for the same reason `named-artifact-resolves` ships one: that
// floor started with 75 standing violations to burn down; this one starts with zero, and a baseline
// over zero is an invitation to grow one.
const NO_STATUS_PROBLEM =
  'no `status:` in frontmatter — README.md requires a `---` block, and this scan (and every ' +
  'other grep over the backlog) reads status from there and nowhere else';

async function listMarkdown(dirAbsolute) {
  try {
    const entries = await fs.readdir(dirAbsolute);
    return entries.filter((name) => name.endsWith('.md') && name !== 'README.md').sort();
  } catch {
    return [];
  }
}

export async function findBacklogPlacementFindings(root = WORKSPACE_ROOT) {
  requireGovernedTree(root, [BACKLOG_DIR, COMPLETED_DIR], {
    scan: 'backlog-placement',
    why: 'Placement is a claim about the backlog tree; with no tree there are no misplaced items and no correct ones either.',
  });
  const findings = [];
  const invalidArchived = [];

  for (const name of await listMarkdown(path.join(root, BACKLOG_DIR))) {
    const relative = path.posix.join(BACKLOG_DIR, name);
    if (relative.startsWith(COMPLETED_DIR)) continue;
    const stat = await fs.stat(path.join(root, relative));
    if (stat.isDirectory()) continue;
    const lifecycle = classifyTaskLifecycle(await fs.readFile(path.join(root, relative), 'utf8'));
    const { status } = lifecycle;
    // A task with no readable `status:` is REPORTED, not skipped, and review found why. `README.md`
    // requires every task file to carry a `---`-delimited frontmatter block and says outright that
    // "grep-based tooling and harness scripts rely exclusively on frontmatter for status tracking"
    // — and this scan, one of that tooling, answered `null` and moved on. A file written with the
    // status in the BODY therefore passed every placement rule below, which is the rule this scan
    // enforces being unenforceable against the one shape that breaks it.
    //
    // Found the ordinary way: a task file added in this very change had no frontmatter and the scan
    // reported clean.
    if (status === null) {
      findings.push({ file: relative, problem: NO_STATUS_PROBLEM });
      continue;
    }
    if (TERMINAL_TASK_STATUSES.has(status)) {
      findings.push({
        file: relative,
        problem: `terminal status "${status}" but still in the backlog root — git mv to completed/`,
      });
      if (!lifecycle.valid) {
        findings.push({
          file: relative,
          problem: lifecycle.problems.join('; '),
        });
      }
    } else if (!lifecycle.valid) {
      findings.push({ file: relative, problem: lifecycle.problems.join('; ') });
    }
  }

  for (const name of await listMarkdown(path.join(root, COMPLETED_DIR))) {
    const relative = path.posix.join(COMPLETED_DIR, name);
    if (LEGACY_COMPLETED_TODO.has(relative)) continue;
    const lifecycle = classifyTaskLifecycle(await fs.readFile(path.join(root, relative), 'utf8'));
    const { status } = lifecycle;
    // The same rule as the root loop, and review found it applied to only one of them. An archived
    // file with no frontmatter passed silently, and the reason the root loop refuses one — that
    // nothing can read the status of a file that does not declare it where the tooling looks — does
    // not stop applying because the file is in `completed/`.
    if (status === null) {
      findings.push({ file: relative, problem: NO_STATUS_PROBLEM });
      continue;
    }
    if (OPEN_TASK_STATUSES.has(status)) {
      findings.push({
        file: relative,
        problem: `open status "${status}" inside completed/ — reopen (move back) or close it`,
      });
    } else if (!lifecycle.valid) {
      invalidArchived.push(`${relative}|${lifecycle.status ?? ''}|${lifecycle.completed ?? ''}`);
    }
  }

  const baselinePath = path.join(root, LEGACY_LIFECYCLE_BASELINE);
  let baseline = null;
  try {
    baseline = JSON.parse(await fs.readFile(baselinePath, 'utf8'));
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const digest = crypto
    .createHash('sha256')
    .update(invalidArchived.sort().join('\n'))
    .digest('hex');
  const baselineMatches = baseline?.count === invalidArchived.length && baseline?.sha256 === digest;
  if ((baseline !== null || invalidArchived.length > 0) && !baselineMatches) {
    findings.push({
      file: COMPLETED_DIR,
      problem:
        `${invalidArchived.length} archived Task lifecycle violation(s) do not match the frozen ` +
        `${LEGACY_LIFECYCLE_BASELINE} (sha256 ${digest}); fix new drift and leave legacy removal to HARNESS-092`,
    });
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
  requireGovernedTree(root, [BACKLOG_DIR, COMPLETED_DIR], {
    scan: 'backlog-placement',
    why: 'An ID collision is a relation between two directories \u2014 reading neither cannot establish that neither collides.',
  });
  const findings = [];
  // The ID includes any phase suffix (`-P3`, `-P4-P5`): a phase follow-up filed while its parent
  // is archived (e.g. open `SELFHOST-008-P5-…` alongside completed `SELFHOST-008-…`) is the
  // intended convention, NOT a duplicate — only an identical ID in both places is.

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

  // A spec-doc ID that NO backlog file claims is a retired number, and a new item must not reuse
  // it. The pairing itself is the convention — 111 IDs currently appear in both trees because a
  // backlog item and its spec-doc share a number by design — so this fires only when the backlog
  // file is the FIRST to claim an ID that spec-docs already spent.
  //
  // Deliberately NOT a slug-equality check. Slugs drift as an item is reworded
  // (`cjk-ime-defer-submit` vs `ime-last-character-drop` is one item, not two), and 34 of the 111
  // pairs differ that way. A guard firing on all 34 would be noise, and a noisy guard gets
  // suppressed — which costs more than the collisions it would catch.
  //
  // Observed 2026-07-26: a new `DIST-002-release-artifact-verification` was filed while
  // `.agents/spec-docs/done/DIST-002-bun-binary-release-workflow.md` already held that number.
  const specIds = new Set();
  for (const dir of await listDirectories(path.join(root, SPEC_DOCS_DIR))) {
    for (const name of await listMarkdown(path.join(root, SPEC_DOCS_DIR, dir))) {
      const id = idOf(name);
      if (id !== null) specIds.add(id);
    }
  }
  for (const [id, name] of rootById) {
    if (!specIds.has(id)) continue;
    // Paired with a spec-doc of its own is the normal case; only an ID with no backlog history
    // before this file is a reuse. `completedById` covers items already archived.
    if (completedById.has(id)) continue;
    const paired = await specDocMatchesBacklog(root, id, name);
    if (paired) continue;
    findings.push({
      file: path.join(BACKLOG_DIR, name),
      problem: `backlog ID ${id} is already spent in ${SPEC_DOCS_DIR}/ by a different item — pick the next free number`,
    });
  }

  return findings;
}

/** Directory names under `.agents/spec-docs/` (draft, backlog, todo, active, done, rejected). */
async function listDirectories(dirAbsolute) {
  try {
    const entries = await fs.readdir(dirAbsolute, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * True when the spec-doc holding `id` is plausibly the SAME item as the backlog file — i.e. this
 * is the intended backlog↔spec pairing rather than a reused number. Compared on the leading slug
 * token, which survives rewording far better than the full slug.
 */
async function specDocMatchesBacklog(root, id, backlogName) {
  const lead = (name) => idOf(name) && name.slice(String(idOf(name)).length + 1).split('-')[0];
  const backlogLead = lead(backlogName);
  for (const dir of await listDirectories(path.join(root, SPEC_DOCS_DIR))) {
    for (const name of await listMarkdown(path.join(root, SPEC_DOCS_DIR, dir))) {
      if (idOf(name) !== id) continue;
      if (lead(name) === backlogLead) return true;
    }
  }
  return false;
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
      'git mv to .agents/tasks/completed/ in the SAME commit as the closing work.\n',
  );
  process.exitCode = 1;
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isDirectExecution) {
  await main();
}
