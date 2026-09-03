#!/usr/bin/env node

/**
 * Issue #2186 — a task record that says the work is underway after its deliverable merged.
 *
 * `.agents/tasks/ARCH-100-…md` kept `status: in-progress` for hours after its deliverable had merged
 * to `develop`; `pnpm harness:scan` passed the whole time, and the session-start hook kept presenting
 * finished work as a live priority. No gate was red about a record whose deliverable had landed.
 *
 * The question is concrete, not a guess about the record's content: for each record under
 * `.agents/tasks/` that is not terminal and not archived, does a commit merged to `develop` cite its
 * work-item ID in the subject AND deliver something outside `.agents/`? This repository's convention
 * puts the ID in the commit subject (`ARCH-100`, `HARNESS-116`, `TRANS-005` all appear in their own
 * subjects), which is the same derivation `promotion-closes.mjs` rides on. The delivery half is what
 * keeps a `docs(tasks): file ARCH-100` commit — which cites the record it creates — from being a hit:
 * measured 2026-09-04, 24 of 130 open records were cited by some subject, most by their own filing.
 *
 * What a finding claims, and does not:
 *   - it is NOT proof the item is complete — one item can span several pull requests, and an early
 *     one citing the ID does not finish it. The finding says "reconcile this record", naming the
 *     citing commit so a reader judges it rather than trusting the scan;
 *   - the scan moves, edits and closes NOTHING — terminal status and archival are the author's call;
 *   - a record with no merged citation produces no finding. Absence is the normal state.
 *
 * Registered `advisory` under `--context pr`: it grades records against history that other pull
 * requests move, so a red here is a reconciliation prompt for the record's owner, never a reason
 * an unrelated change cannot merge. Under `--context integration` it fails as every scan does.
 *
 * Exit code 0 = clean, 1 = findings.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { requireGovernedTree } from './governed-tree.mjs';
import { TERMINAL_TASK_STATUSES, classifyTaskLifecycle } from './task-lifecycle.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);
const TASKS_DIR = '.agents/tasks';
/**
 * Records already in this state when the scan was adopted (16 measured 2026-09-04), frozen so the
 * scan fails only on a NEW coincidence — the file-size-ratchet precedent. Each entry is a pending
 * reconciliation: when its record is reconciled the scan reports the entry as removable.
 */
export const LEGACY_BASELINE = 'scripts/harness/task-merged-citation-legacy-baseline.json';
/** Paths a citing commit may touch WITHOUT counting as a delivery: the records themselves. */
const RECORD_PREFIX = '.agents/';

let examinedRecords = 0;
let examinedCommits = 0;

/** Open task records the last scan READ (measurement-provenance: counted at the read). */
export function examinedRecordCount() {
  return examinedRecords;
}

/** Merged commits the last scan READ. */
export function examinedCommitCount() {
  return examinedCommits;
}

/** `ARCH-100` from `ARCH-100-some-slug.md`; null when the name carries no work-item ID. */
export function workItemIdOf(fileName) {
  const match = /^([A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*-\d+)(?=-|\.md$)/.exec(fileName);
  return match ? match[1] : null;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Does a commit subject cite this ID as a whole token? `ARCH-1000` does not cite `ARCH-100`. */
export function citesWorkItem(subject, id) {
  return new RegExp(`(^|[^A-Za-z0-9-])${escapeRegExp(id)}(?![A-Za-z0-9-])`).test(subject);
}

/** A commit delivers when it touches at least one path outside the records tree. */
export function deliversOutsideRecords(changedPaths) {
  return changedPaths.some((file) => !file.startsWith(RECORD_PREFIX));
}

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    // Fail loud: a history this cannot read is not a history with no citations in it.
    throw new Error(`task-merged-citation: git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

/** The ref whose history counts as "merged": the remote develop when it exists, else the local one. */
export function mergedRef(root) {
  for (const ref of ['origin/develop', 'develop']) {
    const probe = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
      cwd: root,
      encoding: 'utf8',
    });
    if (probe.status === 0) return ref;
  }
  return 'HEAD';
}

/** `{ sha, subject }` for every commit reachable from `ref`, newest first. */
export function mergedCommits(root, ref) {
  return git(root, ['log', '--format=%H%x00%s', ref])
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf('\0');
      return { sha: line.slice(0, separator), subject: line.slice(separator + 1) };
    });
}

/** Paths a commit changed, workspace-relative. */
export function changedPathsOf(root, sha) {
  return git(root, ['diff-tree', '--no-commit-id', '--name-only', '-r', '--root', sha])
    .split('\n')
    .filter(Boolean);
}

/** Non-terminal records directly under `.agents/tasks/` (archived `completed/` is not read). */
export function openTaskRecords(root) {
  const dir = path.join(root, TASKS_DIR);
  const records = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const id = workItemIdOf(entry.name);
    if (id === null) continue;
    const file = path.join(dir, entry.name);
    const { status } = classifyTaskLifecycle(readFileSync(file, 'utf8'));
    if (status !== null && TERMINAL_TASK_STATUSES.has(status)) continue;
    records.push({ id, status, file: path.relative(root, file).split(path.sep).join('/') });
  }
  return records;
}

/** Work-item IDs whose citation was frozen at adoption; a missing file is an empty allowance. */
export function legacyReconcilePending(root) {
  const file = path.join(root, LEGACY_BASELINE);
  if (!existsSync(file)) return new Set();
  return new Set(JSON.parse(readFileSync(file, 'utf8')).reconcilePending ?? []);
}

/**
 * @param {object} [io] injected history seams, so the derivation is testable without a repository;
 *   `notices` collects legacy entries that no longer fire and can be removed from the baseline
 * @returns {Array<{file: string, type: string, detail: string}>}
 */
export function findTaskMergedCitationFindings(root = WORKSPACE_ROOT, io = {}) {
  requireGovernedTree(root, [TASKS_DIR], {
    scan: 'task-merged-citation',
    why: 'The records this compares against merged history live there.',
  });
  const ref = io.ref ?? mergedRef(root);
  const commits = io.commits ?? mergedCommits(root, ref);
  const changedPaths = io.changedPaths ?? ((sha) => changedPathsOf(root, sha));
  const legacy = io.legacy ?? legacyReconcilePending(root);
  const notices = io.notices ?? [];
  const records = openTaskRecords(root);
  examinedRecords = records.length;
  examinedCommits = commits.length;

  const findings = [];
  const stillPending = new Set();
  for (const record of records) {
    const citing = commits.filter((commit) => citesWorkItem(commit.subject, record.id));
    const delivering = citing.filter((commit) => deliversOutsideRecords(changedPaths(commit.sha)));
    if (delivering.length === 0) continue;
    if (legacy.has(record.id)) {
      stillPending.add(record.id);
      continue;
    }
    const named = delivering
      .slice(0, 3)
      .map((commit) => `${commit.sha.slice(0, 9)} ${commit.subject}`)
      .join('; ');
    findings.push({
      file: record.file,
      type: 'task-merged-citation',
      detail:
        `${record.id} is \`${record.status ?? '(no status)'}\` but ${delivering.length} commit(s) ` +
        `merged to ${ref} cite it and deliver outside ${RECORD_PREFIX}: ${named}` +
        `${delivering.length > 3 ? '; …' : ''} — reconcile the record (a citation is not proof ` +
        'of completion: the item may span more pull requests).',
    });
  }
  for (const id of [...legacy].sort()) {
    if (!stillPending.has(id)) {
      notices.push(`${id} no longer fires — remove it from ${LEGACY_BASELINE} (ratchet tightens).`);
    }
  }
  if (stillPending.size > 0) {
    notices.push(
      `${stillPending.size} frozen record(s) still cited by merged delivering commits — reconcile: ${[...stillPending].sort().join(', ')}`,
    );
  }
  return findings;
}

export async function main() {
  const notices = [];
  const findings = findTaskMergedCitationFindings(WORKSPACE_ROOT, { notices });
  process.stdout.write(
    `::examined:: ${examinedRecords} open task record(s), ${examinedCommits} merged commit(s)\n`,
  );
  for (const notice of notices) process.stdout.write(`note: ${notice}\n`);
  if (findings.length === 0) {
    process.stdout.write('task-merged-citation scan passed.\n');
    return;
  }
  process.stdout.write('task-merged-citation scan failed:\n');
  for (const finding of findings) {
    process.stdout.write(`- [${finding.type}] ${finding.file}: ${finding.detail}\n`);
  }
  process.exitCode = 1;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  await main();
}
