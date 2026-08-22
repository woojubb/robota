#!/usr/bin/env node

/**
 * One work-item ID names one item (issue #1916).
 *
 * A work-item ID (`INFRA-nnn`, `PEER-nnn`, `ARCH-nnn`) is allocated by reading the current highest
 * number and adding one. Nothing owns the allocation, so two items can hold one ID and the tree does
 * not say so. Three collisions landed in one session, and the third happened WHILE fixing the first:
 * the number re-derived to had been taken by an issue opened between two reads.
 *
 * WHAT THIS CLOSES, AND WHAT IT DOES NOT. This is the half a repository can decide by itself and
 * decide exactly: an ID held by two distinct TRACKED RECORDS. That is a fact about the tree, so a
 * clone can judge it offline and a push can be refused on it.
 *
 * The half it does not close is the one that actually bit. Those three collisions were between a
 * record in one clone and an ISSUE TITLE opened by another session — and nothing in this tree says
 * which issue registers which record, so the comparison cannot be made. Measured: 48 IDs are claimed
 * by both a record and an issue title, 39 of those records carry no reference to that issue's
 * number, and they are overwhelmingly the SAME item written twice rather than two items. A scan over
 * the union of both sources would report those 39 as collisions. The missing piece is not the
 * network — it is the link, and 7 of 795 records carry one.
 *
 * THE HISTORICAL SET IS ALLOWLISTED, NOT RENUMBERED. Seven IDs collide today. Every one is a
 * `<PREFIX>-001` from before the convention settled, every one is in `completed/`, and the commits
 * and pull requests that delivered them name the old numbers and cannot be rewritten. Renaming the
 * files would move the record out from under every citation that points at it, which is the failure
 * this scan exists to prevent, applied to itself.
 *
 * PHASE FILES ARE NOT COLLISIONS. `ARCH-002-p7-…` and `ARCH-003-p8a-…` are one item split into
 * phases, a convention this repository already uses 30 times. A phase file is recognised by the
 * `-p<N>` segment directly after the ID and is attributed to its parent.
 *
 * Usage:
 *   node scripts/harness/scan-work-item-id-collision.mjs
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { findUnlinkedRecords } from './task-record-issue-link.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const TASKS_PREFIX = '.agents/tasks/';

/**
 * The IDs that collide today, each with why it is not being renumbered.
 *
 * An entry here is a statement that the collision is HISTORICAL and unrewritable, not that it is
 * acceptable. A NEW id must never be added: the whole point is that a fresh collision is refused
 * before it can be pushed.
 */
export const HISTORICAL_COLLISIONS = new Map([
  ['CLI-001', 'two pre-convention items, both completed and merged'],
  ['CLI-002', 'two pre-convention items, both completed and merged'],
  ['DOC-001', 'two pre-convention items, both completed and merged'],
  ['DOCS-001', 'two pre-convention items, both completed and merged'],
  ['EX-001', 'two pre-convention items, both completed and merged'],
  ['NAMING-001', 'two pre-convention items, both completed and merged'],
  ['SEC-001', 'three pre-convention items, all completed and merged'],
]);

/**
 * The ID a record claims, or null when the path claims none.
 *
 * `.agents/tasks/HARNESS-070-lint-warnings-have-no-ceiling.md` claims `HARNESS-070`. The example is
 * a LIVE record on purpose: `named-artifact-resolves` does not index `completed/`, since an archive
 * names a tree that has moved on, so a citation into it resolves to nothing.
 */
export function workItemIdOf(relativePath) {
  if (!relativePath.startsWith(TASKS_PREFIX) || !relativePath.endsWith('.md')) return null;
  const base = path.basename(relativePath);
  return /^([A-Z][A-Z0-9]*-\d+)-/.exec(base)?.[1] ?? null;
}

/**
 * Is this the record of a PHASE of its ID's item rather than a second item claiming the ID?
 *
 * The segment right after the ID: `-p7-`, `-p8a-`, `-P4-`. Case-insensitive because both spellings
 * are in the tree (`ARCH-002-p7-…`, `SELFHOST-003-P4-…`), and asserting one of them here would
 * report the other as a collision it is not.
 */
export function isPhaseRecord(relativePath) {
  const base = path.basename(relativePath);
  return /^[A-Z][A-Z0-9]*-\d+-[Pp]\d+[a-z]?-/.test(base);
}

let examinedRecords = 0;

/**
 * How many tracked task records the last read returned. The size the pass line reports.
 *
 * HARNESS-057: a scan states the size of what it examined, so a subject that silently shrank to
 * nothing cannot pass every rule it has by virtue of holding nothing.
 */
export function examinedRecordCount() {
  return examinedRecords;
}

/** The default subject: every tracked file under the tasks tree, as repository-relative paths. */
function gitTrackedTaskRecords(root) {
  const result = spawnSync('git', ['ls-files', '-z', '--', TASKS_PREFIX], {
    cwd: root,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    // Fail-closed. A collision guard that cannot read the tree has verified nothing, and reporting
    // a pass over an unread tree is the defect one level up from the one it is looking for.
    throw new Error(
      `work-item-id-collision: could not list tracked files under ${TASKS_PREFIX} ` +
        `(git exit ${result.status}): ${(result.stderr ?? '').trim() || 'no stderr'}`,
    );
  }
  return (result.stdout ?? '').split('\0').filter(Boolean);
}

/**
 * Read the subject and record its size. The finder the counter above is asserted through.
 *
 * `list` is injectable so a test can hand it a subject of a size it chose — the counter is only
 * meaningful if a case can prove it MOVED, and a live tree that grows by one record a day cannot be
 * asserted against an exact number without the assertion becoming maintenance.
 */
export function scanTaskRecords({ root = WORKSPACE_ROOT, list = gitTrackedTaskRecords } = {}) {
  const records = list(root);
  examinedRecords = records.length;
  return records;
}

/**
 * Group the records by ID, counting only the ones that CLAIM the ID rather than extend it.
 *
 * Returns `Map(id → string[])` holding every id with two or more claimants, allowlist included —
 * the caller decides what to report, so a test can see the allowlisted ones too.
 */
export function collisionsIn(records) {
  const byId = new Map();
  for (const record of records) {
    const id = workItemIdOf(record);
    if (id === null || isPhaseRecord(record)) continue;
    byId.set(id, [...(byId.get(id) ?? []), record]);
  }
  return new Map(
    [...byId].filter(([, paths]) => paths.length > 1).map(([id, p]) => [id, p.sort()]),
  );
}

function main() {
  // issue #1916, the second half. The cross-source case — an ID claimed by a record here and by an
  // ISSUE TITLE opened elsewhere — cannot be decided while nothing says which issue registers which
  // record. Requiring the link on records a change ADDS is what makes that comparison possible
  // later; see `task-record-issue-link.mjs` for why it is forward-only.
  const baseIndex = process.argv.indexOf('--base-ref');
  const baseRef = baseIndex === -1 ? undefined : process.argv[baseIndex + 1];
  const unlinked = baseRef === undefined ? [] : findUnlinkedRecords(baseRef);

  const records = scanTaskRecords();
  const collisions = collisionsIn(records);
  const fresh = [...collisions].filter(([id]) => !HISTORICAL_COLLISIONS.has(id));

  // The allowlist is not allowed to outlive what it excuses. An entry whose id no longer collides is
  // a permission nobody needs, and a stale one is how an allowlist quietly becomes the rule.
  const stale = [...HISTORICAL_COLLISIONS.keys()].filter((id) => !collisions.has(id));

  console.log(`::examined:: ${records.length} tracked task record(s)`);

  if (fresh.length === 0 && stale.length === 0 && unlinked.length === 0) {
    console.log('work-item-id-collision scan passed.');
    return 0;
  }

  for (const record of unlinked) {
    console.error(
      `work-item-id-collision: ${record} is a NEW task record that names no issue. An ID claimed ` +
        'by a record here and by an issue title opened elsewhere is the collision this scan cannot ' +
        'see, and the link is what would let it. Add `issue #N` (or the issue URL), or write ' +
        '`no-issue: <reason>` on a line if this item genuinely has none.',
    );
  }
  for (const [id, paths] of fresh) {
    console.error(`work-item-id-collision: ${id} is claimed by ${paths.length} distinct records:`);
    for (const p of paths) console.error(`  ${p}`);
  }
  if (fresh.length > 0) {
    console.error(
      'A work-item ID is how a commit message, a pull request body and a rule section point at ' +
        'one record. Pick the next free number and rename BEFORE pushing — once the citations are ' +
        'merged the correction can only be a forwarding note.',
    );
  }
  for (const id of stale) {
    console.error(
      `work-item-id-collision: ${id} is allowlisted as a historical collision but no longer ` +
        'collides. Remove it from HISTORICAL_COLLISIONS.',
    );
  }
  return 1;
}

// Not a `file://` string comparison: that is false whenever the path holds a character a URL
// escapes, and it fails toward silence — `main()` would not run and the exit would read as a pass.
if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  process.exit(main());
}
