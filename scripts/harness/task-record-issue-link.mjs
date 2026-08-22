/**
 * A NEW task record names the issue that registered it (issue #1916).
 *
 * `work-item-id-collision` closes the half a clone can decide offline: one ID, one tracked record.
 * It cannot see the half that actually bit — an ID claimed by a record in one clone and by an ISSUE
 * TITLE opened by another session minutes earlier. Three collisions landed that way, and the third
 * happened WHILE fixing the first.
 *
 * ## The missing piece was never the network
 *
 * Measured when this landed: 48 IDs are claimed by both a record and an issue title, and 39 of those
 * records carry no reference to that issue's number — yet they are overwhelmingly the SAME item
 * written twice, not two items. So a scan over the union of both sources reports 39 false
 * collisions. What is absent is the LINK, and 87 of 798 records have one in any form.
 *
 * Requiring it makes the cross-source comparison exact: an ID claimed by a record and by an issue
 * the record names is one item; an ID claimed by a record and by an issue it does NOT name is two.
 *
 * ## Forward-only, because a retroactive sweep would be a guess
 *
 * 711 records carry no citation, most of them completed and merged. Back-filling them means deciding
 * which issue each one meant, from a distance, for work that is finished — and a wrong link is worse
 * than none, because the cross-source check would then treat two items as one. So this judges the
 * records a change ADDS, and the existing tree is left as it is.
 *
 * That also means the exact cross-source scan cannot be built yet: it needs the link on both sides
 * of a comparison, and today it is on one. This is the step that makes it possible, not the step
 * that does it.
 *
 * ## What counts as naming the issue
 *
 * Any of the three forms already in the tree — `Registered as … issue #N`, a bare `issue #N`, or a
 * `github.com/…/issues/N` URL. Not a fourth spelling invented here: the point is a machine-readable
 * link, and a record that already writes one of these should not have to write another.
 *
 * `no-issue: <reason>` on any line opts out. An item that genuinely has no issue — a phase of a
 * parent, a record split out of another — is a judgement, and one written next to the work is one
 * the next reader can weigh.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const TASKS_PREFIX = '.agents/tasks/';

/** The three spellings already in the tree. A record satisfying any of them names its issue. */
export const ISSUE_LINK_PATTERNS = [
  /Registered as[^\n]{0,60}issue #\d+/,
  /\bissue #\d+/,
  /github\.com\/[^)\s]+\/issues\/\d+/,
];

/** `no-issue: <reason>` — a deliberate exception, written where the next reader will find it. */
const OPT_OUT = /no-issue:\s*(\S.*)/i;

/** Does this record name the issue that registered it, or say why it has none? */
export function namesItsIssue(content) {
  return OPT_OUT.test(content) || ISSUE_LINK_PATTERNS.some((pattern) => pattern.test(content));
}

/** A phase of a parent carries the parent's registration. Same convention the collision scan uses. */
export function isPhaseRecord(relativePath) {
  return /^[A-Z][A-Z0-9]*-\d+-[Pp]\d+[a-z]?-/.test(path.basename(relativePath));
}

/** Is this a task record with a work-item ID? README.md and un-prefixed files are not. */
export function isTaskRecord(relativePath) {
  return (
    relativePath.startsWith(TASKS_PREFIX) &&
    relativePath.endsWith('.md') &&
    /^[A-Z][A-Z0-9]*-\d+-/.test(path.basename(relativePath))
  );
}

/**
 * The task records a change ADDS, relative to `baseRef`.
 *
 * `--diff-filter=A` only: a change that edits an existing record must not be asked to back-fill a
 * link it never claimed to have. Fail-closed — an unreadable diff throws rather than reporting an
 * empty set, because "no new records" and "could not look" are different answers.
 */
export function addedTaskRecords(baseRef, root = WORKSPACE_ROOT) {
  const result = spawnSync(
    'git',
    ['diff', '--name-only', '--diff-filter=A', `${baseRef}...HEAD`, '--', TASKS_PREFIX],
    { cwd: root, encoding: 'utf8' },
  );
  if (result.status !== 0) {
    throw new Error(
      `task-record-issue-link: could not read the diff against \`${baseRef}\` — the measurement ` +
        `FAILED, so no verdict can be reported from it.\n${result.stderr ?? ''}`,
    );
  }
  return (result.stdout ?? '').split('\n').filter(Boolean).filter(isTaskRecord);
}

/** Every added record that names no issue and claims no exception. */
export function findUnlinkedRecords(baseRef, root = WORKSPACE_ROOT) {
  const findings = [];
  for (const relative of addedTaskRecords(baseRef, root)) {
    if (isPhaseRecord(relative)) continue;
    const file = path.join(root, relative);
    // Added-then-deleted in the same range: nothing to judge, and reading it would throw.
    if (!existsSync(file)) continue;
    if (namesItsIssue(readFileSync(file, 'utf8'))) continue;
    findings.push(relative);
  }
  return findings;
}
