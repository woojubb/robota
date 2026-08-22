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
 * Measured with the predicates this module ships — `namesItsIssue` and `ISSUE_LINK_PATTERNS` — over
 * the 48 IDs claimed by BOTH a record and an issue title:
 *
 *   44  the record names that issue's own number
 *    3  the record names a DIFFERENT issue (`ARCH-037`→#1805 cites 1764/1773; `ARCH-039`→#1828
 *       cites 1764; `HARNESS-074`→#1619 cites 1615)
 *    1  the record names none at all (`HARNESS-058`→#1571)
 *
 * So the gap is FOUR citation lines in four named files, not a wait for new records to accumulate.
 * A first cut of this header said 39, which was a frontmatter-only count carried over from the
 * item's discussion, and two attempts to re-derive it here produced 39 and then 2 — both from a
 * `#\d+\b` pattern whose `\b` does nothing after a digit. The number that survived was the one a
 * reviewer measured independently and this session then reproduced. Recorded because the wrong
 * figure was the load-bearing one: it made the burn-down look unbounded when it is four lines.
 *
 * Across the whole tree the link is on 87 of 798 records.
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
 * ## Three things this does NOT establish, said here so nobody reads the link as stronger
 *
 * **It does not PREVENT a collision, only make one detectable at push time.** A clone-local branch
 * is invisible in principle to every mechanism that reads the tracked tree — not through a parsing
 * gap that better code would close, but because the claim has not been published yet. Two sessions
 * can still both pick the same number; the second is caught when it pushes, not when it chooses.
 *
 * **It does not keep the link true.** A record can cite an issue later closed as a duplicate,
 * retitled, or transferred to another repository. That is not a collision, so a collision scan never
 * sees it, and the cross-source comparison would then read a record and an unrelated issue as one
 * item — the exact failure the forward-only rule exists to avoid, arriving later instead of at
 * birth.
 *
 * **And it does not establish the link was ever true.** A body link is written once by whoever files
 * the record and nothing confirms the issue is about it. A wrong-on-day-one link leaves no signal
 * and reads as verified precisely because it is well-formed and machine-parseable. Issue #1980 is
 * the worked example: `.github/required-status-checks.json` declared four required contexts where
 * the live ruleset had three, and it was believed for four weeks because it was a well-formed
 * declaration in the right file. It was not stale; it was never true.
 *
 * Closing those needs a live read of the issue, which no tracked-tree scan can do. The useful
 * assertion is not "the link resolves" but "the link resolves AND that issue's title still claims
 * this record's ID" — the same comparison, turned on the record's own claim rather than only on
 * record-versus-record collisions.
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

/**
 * A part of a parent carries the parent's registration. Same convention the collision scan uses,
 * and the same two spellings: a numbered phase (`-p7-`, `-P4-`) and a lettered split (`-A-` … `-F-`,
 * which `INFRA-BL-009` uses across six files).
 */
export function isPhaseRecord(relativePath) {
  return new RegExp(`^${ID_PREFIX}-(?:[Pp]\\d+[a-z]?|[A-Z])-`).test(path.basename(relativePath));
}

/**
 * The shape of a work-item ID, prefix included.
 *
 * Multi-segment prefixes are real and common: `ARCH-FIX-020`, `INFRA-BL-009`, `DQ-AUDIT-005`.
 * Reported in review — requiring the digits after the FIRST segment excluded 97 records, and a new
 * `ARCH-FIX-022-…` would have been SILENTLY exempt from the requirement this module imposes. A rule
 * that does not reach part of its population is a rule about the part it reaches.
 */
const ID_PREFIX = '[A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*-\\d+';

/** Is this a task record with a work-item ID? README.md and un-prefixed files are not. */
export function isTaskRecord(relativePath) {
  return (
    relativePath.startsWith(TASKS_PREFIX) &&
    relativePath.endsWith('.md') &&
    new RegExp(`^${ID_PREFIX}-`).test(path.basename(relativePath))
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

/**
 * How many tracked records carry a link, and how many do not.
 *
 * BOTH numbers, because a consumer of the link that reported its size as "records carrying a link"
 * would be describing the population it can see and calling it the population. A later scan reading
 * these links reports "no cross-source collisions" over a set that excludes every record it could
 * not read — which is issue #1916's own failure, one layer up. The pair is what makes the gap
 * visible instead of invisible.
 *
 * THREE numbers, after review: a record with no work-item id and a phase record are neither linked
 * nor unlinked, and dropping them silently made the pair fail to sum to the examined total — the gap
 * unstated on the very line that exists to make the population honest.
 */
export function linkCoverage(
  records,
  readFile = (f) => readFileSync(path.join(WORKSPACE_ROOT, f), 'utf8'),
) {
  let linked = 0;
  let unlinked = 0;
  let notJudged = 0;
  for (const relative of records) {
    // Counted, not dropped. Reported in review: `994 … 87 name an issue, 696 do not` sums to 783,
    // and the missing 211 were exactly the population the ID pattern could not see — unstated on
    // the very line the pair exists to make honest.
    if (!isTaskRecord(relative) || isPhaseRecord(relative)) {
      notJudged += 1;
      continue;
    }
    let content;
    try {
      content = readFile(relative);
    } catch {
      // Unreadable counts as UNLINKED, never as absent. A record this cannot open is a record a
      // consumer cannot compare, which is the thing the pair exists to report.
      unlinked += 1;
      continue;
    }
    if (namesItsIssue(content)) linked += 1;
    else unlinked += 1;
  }
  return { linked, unlinked, notJudged };
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
