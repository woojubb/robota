#!/usr/bin/env node

/**
 * Allocate a work-item ID and write its record in ONE operation (issue #1916, option 2).
 *
 * ## The gap this closes
 *
 * `scan-work-item-id-collision` refuses an ID held by two tracked RECORDS. That is the half a clone
 * can judge offline, and it is not the half that bites. An ID is allocated by reading the current
 * highest number and adding one, and the read has a shelf life measured in minutes when more than
 * one session is working — so the collision is created between the read and the write, which is
 * exactly where no scan can stand.
 *
 * Making the read and the claim the same operation is what removes that window. This script does
 * not survey and advise; it takes the number and writes the file.
 *
 * ## What "claimed" means here, measured
 *
 * The record filenames are NOT the claimed set. Measured on 2026-08-22: 867 IDs have a record file
 * and **63 more are claimed by a tracked file that is not a record** — a rule citing the item that
 * introduced it, a scan header, a hook comment, an archived breakdown. `INFRA-127` was one of them:
 * `scan-task-frontmatter-fields.mjs` and `scan-rule-table-shape.mjs` both cite it and no
 * `.agents/tasks/INFRA-127-*.md` exists, so `ls .agents/tasks | grep INFRA` reported 126 as the
 * highest and the next allocation walked straight into a live number. That happened while writing
 * this file's own sibling, which is why the citation half is here rather than deferred.
 *
 * Issues — titles AND bodies — are the third source and the one the original three collisions came
 * from. They are read when the network and `gh` are both available, and their ABSENCE is reported rather than
 * assumed away — an allocator that quietly skips a source allocates from a smaller set than it
 * claims to, which is the failure it exists to prevent.
 *
 * ## Why it never reuses a gap
 *
 * The next ID is one above the highest CLAIMED number, not the lowest free one. A gap in the
 * sequence is usually a number that was claimed by something this script cannot see — a branch not
 * yet pushed, an issue in a session that has not opened it yet — and handing it out is the collision
 * again with extra confidence. Counting up is monotone and cheap.
 *
 * Usage:
 *   node scripts/harness/allocate-work-item-id.mjs INFRA "the slug of the problem"
 *   node scripts/harness/allocate-work-item-id.mjs INFRA "…" --issue 1916
 *   node scripts/harness/allocate-work-item-id.mjs INFRA --dry-run     # print the ID, write nothing
 *   node scripts/harness/allocate-work-item-id.mjs INFRA "…" --allow-stale  # behind origin/develop, knowingly
 *
 * A clone BEHIND `origin/develop` is refused (issue #2184): its records and citations are stale
 * together, so the answer would be plausible and possibly taken. `--allow-stale` accepts that risk
 * visibly; an offline clone that cannot fetch still allocates, and says which measurement it lacked.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { resolveWorkspaceRoot } from './shared.mjs';

// stdout is the payload here (the allocated ID, and the file it was written to), so the root
// announcement goes to stderr.
const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);
const TASKS_DIR = '.agents/tasks';

/** A work-item ID: one or more uppercase segments, then a number. `ARCH-FIX-020` is one. */
export const WORK_ITEM_ID = /\b([A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*)-(\d{3,})\b/g;

/**
 * Every ID that has a record file, live or completed.
 *
 * `completed/` counts. An archived item's number is still cited by the commits and pull requests
 * that delivered it, so handing it out again points every one of those citations at new work.
 */
export function idsFromRecords(root = WORKSPACE_ROOT) {
  const dirs = [path.join(root, TASKS_DIR), path.join(root, TASKS_DIR, 'completed')];
  const ids = new Set();
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.md')) continue;
      const match = /^([A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*-\d{3,})/.exec(name);
      if (match) ids.add(match[1]);
    }
  }
  return ids;
}

/**
 * Every ID cited by a tracked file, whether or not a record exists for it.
 *
 * Deliberately unfiltered: a fixture ID like `CLI-999` costs one skipped number and a missed real
 * claim costs a collision. The asymmetry decides it.
 */
export function idsFromCitations(root = WORKSPACE_ROOT) {
  // `-w`, not `\b`: Apple Git's `-E` has no `\b`, and the pattern then matched NOTHING — the
  // citation source came back empty and the run said "0 from citations" as if that were a
  // measurement (found while fixing issue #2390; the reporter's 1493 was read under GNU git).
  const grep = spawnSync('git', ['grep', '-hoIwE', '[A-Z][A-Z0-9]*(-[A-Z][A-Z0-9]*)*-[0-9]{3,}'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  // Exit 1 is "no match", which is a legitimate empty result; anything else means the tree was not
  // read, and an allocator that treats "could not read" as "nothing is claimed" hands out live IDs.
  if (grep.status !== 0 && grep.status !== 1) {
    throw new Error(
      `allocate-work-item-id: could not read tracked files (git grep exited ${grep.status}). ` +
        'Refusing rather than allocating from a set that was never read.\n' +
        `${grep.stderr ?? ''}`,
    );
  }
  const ids = new Set();
  for (const line of (grep.stdout ?? '').split('\n')) {
    const trimmed = line.trim();
    if (/^[A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*-\d{3,}$/.test(trimmed)) ids.add(trimmed);
  }
  return ids;
}

/**
 * Every ID named by an issue — its title OR its body — or `null` when the source could not be read.
 *
 * Bodies are read as well as titles because an ID is declared there too: issue #2049's body named
 * `ARCH-050` and `ARCH-060` with no record and no tracked citation, and a body is the one place an
 * ID can be claimed that no scan over the tree will ever reach (issue #2322). The source is one
 * field away from the titles this already read, and the reasoning for reading titles applies
 * unchanged.
 *
 * `null` is not an empty set and the two must not be conflated: an empty set says no issue claims
 * an ID, and `null` says nobody asked. The caller reports which one it got.
 */
export function idsFromIssues({ run = defaultGh } = {}) {
  const result = run();
  if (result === null) return null;
  const ids = new Set();
  for (const text of result) {
    for (const match of text.matchAll(WORK_ITEM_ID)) ids.add(match[0]);
  }
  return ids;
}

/** One line per issue title and per body line; the ID pattern never spans a line. */
function defaultGh() {
  const listed = spawnSync(
    'gh',
    [
      'issue',
      'list',
      '--state',
      'all',
      '--limit',
      '1000',
      '--json',
      'title,body',
      '-q',
      '.[] | .title, .body',
    ],
    { cwd: WORKSPACE_ROOT, encoding: 'utf8', timeout: 30_000, maxBuffer: 64 * 1024 * 1024 },
  );
  if (listed.status !== 0) return null;
  return (listed.stdout ?? '').split('\n').filter((line) => line.trim() !== '');
}

/**
 * RESET per union, so a run that reads nothing cannot report the previous run's number.
 *
 * Incremented as the union is built rather than taken from `claimed.size` afterwards: a size read
 * off a collection is the size of the collection, and a Set additionally swallows every duplicate —
 * which is precisely where the three sources overlap most.
 */
let examinedCount = 0;

export function readExamined() {
  return examinedCount;
}

/** The union of every source that could be read. `null` from a source contributes nothing. */
export function collectClaimed(records, citations, issues) {
  examinedCount = 0;
  const claimed = new Set();
  for (const source of [records, citations, issues]) {
    if (source === null) continue;
    for (const id of source) {
      if (claimed.has(id)) continue;
      claimed.add(id);
      examinedCount += 1;
    }
  }
  return claimed;
}

/**
 * Numbers at or above this are fixture space, not allocations, and are skipped when counting up.
 *
 * MEASURED, not assumed. Of the 867 IDs with a record file on 2026-08-22, **zero** are at or above
 * 900. Of the 18 citations that are, every one is either a test fixture (`NOSUCH-999`, `CLI-996`
 * through `CLI-999`, `INFRA-900` through `INFRA-902`) or not a work-item ID at all (`CVE-2024`,
 * `ISO-8601`, `RFC-7807` — the pattern cannot tell them apart and does not need to, since nothing
 * allocates under those prefixes).
 *
 * Without this the first run of this script returned `INFRA-1000`, because `INFRA-999` is a fixture
 * in the collision scan's own test. Counting up from a sentinel is how a deliberately out-of-band
 * number becomes the sequence.
 */
export const SENTINEL_FLOOR = 900;

/**
 * Digits in an allocated number. MEASURED: all 916 record filenames use exactly three.
 *
 * Fixed rather than inferred from the claimed set, and that is the second attempt. Inferring it let
 * PROSE set the padding: `idsFromCitations` reads the working-tree content of every tracked file, so
 * a comment in this module that mentioned a four-digit form made that form the highest claim, and
 * the next allocation came back four digits wide. The number a citation claims is worth honouring;
 * the house style it appears to imply is not.
 *
 * A prefix that legitimately passes 999 needs this widened deliberately, which is the right amount
 * of friction for a decision that renames a convention.
 */
export const RECORD_ID_WIDTH = 3;

function formatId(prefix, number) {
  return `${prefix}-${String(number).padStart(RECORD_ID_WIDTH, '0')}`;
}

/**
 * The next ID for `prefix`: one above the highest number any source claims for it, and never a
 * number any source claims.
 *
 * Width follows the widest claim already in use, so a repository at `INFRA-099` moves to
 * `INFRA-100` rather than to `INFRA-0100`.
 *
 * Issue #2390: the sentinel floor is a convention, and two things met at it — a fixture at
 * `floor - 1` made `floor` the next allocation, and a live record AT the floor was skipped as
 * fixture space, so the one number about to be handed out was the one this function could not see
 * was taken. Two changes: a RECORD claims its number wherever it sits, and the candidate is walked
 * past anything the union claims (fixture or not) rather than proposed on top of it.
 */
export function nextFreeId(prefix, claimed, sentinelFloor = SENTINEL_FLOOR, records = new Set()) {
  const pattern = new RegExp(`^${prefix}-(\\d{3,})$`);
  let highest = 0;
  for (const id of claimed) {
    const match = pattern.exec(id);
    if (!match) continue;
    const number = Number(match[1]);
    if (number >= sentinelFloor && !records.has(id)) continue;
    highest = Math.max(highest, number);
  }
  let candidate = highest + 1;
  while (claimed.has(formatId(prefix, candidate))) candidate += 1;
  return formatId(prefix, candidate);
}

/**
 * The LOCAL calendar date, `YYYY-MM-DD` — the same formula `gate.mjs` exports (issue #2415).
 *
 * Every other date the harness writes — gate entries, `completed:`, the delegated-class `Registered`
 * column — is the local date, so a `created:` sliced from the ISO (UTC) instant is one day behind the
 * gate entries that follow it whenever the allocation happens after midnight local time. Mirrored
 * rather than imported: `gate.mjs` pulls `run-all-scans.mjs` and three scan modules, and a script
 * that writes one file should not load the scan registry to learn the date.
 */
export function localDate(date = new Date(), timeZone = undefined) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

/**
 * The `## User Execution Test Scenarios` section `.agents/rules/backlog-execution.md` requires of
 * every Task record (issue #2308), in the Task's exact author-verdict form from that rule's
 * checkpoint-evidence contract. Emitted with the cheap correct answer in front of the author —
 * `not-applicable` plus a reason — because an author fills in the sections the skeleton gives them,
 * and 267 completed records were closed without this one.
 */
export const USER_EXECUTION_SECTION = `## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** \`SCENARIO DRAFTED: not-applicable | 0\`

**Reason:** TODO — why no end user can observe this change directly through a runnable surface.
`;

/**
 * A YAML single-quoted scalar. The only escape the form has is the doubled quote: `it's` is written
 * `'it''s'`. Interpolating the text raw let an apostrophe in the title terminate the scalar early
 * (issue #2298) — `.agents/tasks/README.md` declares the frontmatter to be YAML, so the generator
 * has to emit YAML, whatever the in-repo reader happens to tolerate.
 */
export function yamlSingleQuoted(text) {
  return `'${String(text).replace(/'/g, "''")}'`;
}

/** The stub a fresh record starts as — every field `.agents/tasks/README.md` declares required. */
export function recordStub({ id, title, today, issue = null }) {
  return `---
title: ${yamlSingleQuoted(`${id}: ${title}`)}
${issue === null ? '' : `issue: https://github.com/woojubb/robota/issues/${issue}\n`}status: todo
created: ${today}
priority: medium
urgency: soon
area: TODO
depends_on: []
---

# ${id}: ${title}

## Objective

TODO

## Plan

- [ ] TODO

${USER_EXECUTION_SECTION}`;
}

/**
 * Positional arguments only: flags AND the values they take.
 *
 * Filtering on `startsWith('--')` alone leaves `--issue`'s number behind, and the number becomes
 * part of the title and the slug. Caught by running this script on its own record, which produced
 * `INFRA-129-…-in-one-operation-1916.md`.
 */
export function positionalArgs(argv, flagsTakingValue = ['--issue']) {
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (flagsTakingValue.includes(token)) {
      index += 1;
      continue;
    }
    if (token.startsWith('--')) continue;
    positional.push(token);
  }
  return positional;
}

/** The integration branch every allocation must be current with. */
export const UPSTREAM_REF = 'origin/develop';

/**
 * Is this clone BEHIND the integration branch? (issue #2184)
 *
 * The sources above cover a source being UNREACHABLE. They do not cover every source being stale
 * TOGETHER: in a clone behind its upstream the records and the citations agree with each other and
 * the open-issue titles do not contradict them, so the allocator is internally consistent and
 * externally wrong — it returned `TRANS-005` minutes after PR #2182 had delivered and archived it.
 * A plausible number is the dangerous answer; a refusal is the honest one.
 *
 * Offline is NOT stale. A fetch that fails (no network) falls back to the `origin/develop` the clone
 * already has, and a clone with no such ref at all reports `unknown` so the caller can say the
 * measurement was unavailable rather than silently narrow. Only behind-and-knowable refuses.
 *
 * Returns `{ status: 'fresh' | 'stale' | 'unknown', behind, upstreamSha, fetched, reason }`.
 */
export function treeFreshness({ root = WORKSPACE_ROOT, upstream = UPSTREAM_REF } = {}) {
  const git = (args, timeout) =>
    spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout, maxBuffer: 1024 * 1024 });
  const [remote, ...branchParts] = upstream.split('/');
  const branch = branchParts.join('/');
  const fetch = git(['fetch', '--quiet', remote, branch], 30_000);
  const fetched = fetch.status === 0;
  const resolved = git(['rev-parse', '--verify', '--quiet', `${upstream}^{commit}`]);
  if (resolved.status !== 0) {
    return {
      status: 'unknown',
      behind: null,
      upstreamSha: null,
      fetched,
      reason: `${upstream} is not a ref in this clone${fetched ? '' : ' and could not be fetched'}.`,
    };
  }
  const upstreamSha = resolved.stdout.trim();
  const count = git(['rev-list', '--count', `HEAD..${upstream}`]);
  if (count.status !== 0) {
    return {
      status: 'unknown',
      behind: null,
      upstreamSha,
      fetched,
      reason: `git rev-list --count HEAD..${upstream} exited ${count.status}.`,
    };
  }
  const behind = Number(count.stdout.trim());
  return {
    status: behind > 0 ? 'stale' : 'fresh',
    behind,
    upstreamSha,
    fetched,
    reason: fetched ? null : `${upstream} could not be fetched; measured against the local copy.`,
  };
}

function main(argv) {
  const args = positionalArgs(argv);
  const prefix = args[0];
  if (!prefix || !/^[A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)*$/.test(prefix)) {
    console.error(
      'usage: allocate-work-item-id.mjs <PREFIX> "<title>" [--issue N] [--dry-run] [--allow-stale]',
    );
    return 2;
  }
  const title = args.slice(1).join(' ');
  const dryRun = argv.includes('--dry-run');
  const issueAt = argv.indexOf('--issue');
  const issue = issueAt === -1 ? null : argv[issueAt + 1];
  if (issueAt !== -1 && (issue === undefined || issue.startsWith('--'))) {
    console.error('allocate-work-item-id: --issue requires a value');
    return 2;
  }

  // Issue #2184: refuse, rather than answer, when the clone cannot see the current tree.
  const freshness = treeFreshness();
  if (freshness.status === 'stale' && !argv.includes('--allow-stale')) {
    console.error(
      `allocate-work-item-id: this clone is ${freshness.behind} commit(s) behind ${UPSTREAM_REF} ` +
        `(${freshness.upstreamSha.slice(0, 9)}). Every tree-derived source — records and citations — ` +
        'is stale together, so any number allocated here is plausible and possibly taken. ' +
        'Fast-forward (git pull --ff-only) and re-run, or pass --allow-stale to accept the risk knowingly.',
    );
    return 1;
  }
  console.log(
    freshness.status === 'unknown'
      ? `::measured:: freshness UNKNOWN — ${freshness.reason} Allocating from a tree that may be behind.`
      : `::measured:: HEAD is ${freshness.behind} commit(s) behind ${UPSTREAM_REF}@${freshness.upstreamSha.slice(0, 9)}` +
          (freshness.fetched ? '' : ` (${freshness.reason})`) +
          (freshness.status === 'stale' ? ' — --allow-stale accepted' : ''),
  );

  const records = idsFromRecords();
  const citations = idsFromCitations();
  const issues = idsFromIssues();

  const claimed = collectClaimed(records, citations, issues);
  const id = nextFreeId(prefix, claimed, SENTINEL_FLOOR, records);

  console.log(
    `::examined:: ${readExamined()} claimed work-item id(s); ` +
      `${records.size} from records, ${citations.size} from citations, ` +
      (issues === null
        ? 'issue titles and bodies UNREAD'
        : `${issues.size} from issue titles and bodies`),
  );
  if (issues === null) {
    console.log(
      '  issue titles and bodies could not be read (no `gh`, no network, or not authenticated). The three ' +
        'collisions this allocator exists for were all between a record and an issue title, so ' +
        'this run allocated from a SMALLER set than the one that matters. Re-check before pushing.',
    );
  }

  if (dryRun || title === '') {
    console.log(id);
    return 0;
  }

  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
  const file = path.join(TASKS_DIR, `${id}-${slug}.md`);
  const absolute = path.join(WORKSPACE_ROOT, file);
  const today = localDate();
  try {
    // `wx` — create-or-fail, in ONE syscall. An `existsSync` followed by a write is a check and a
    // claim with a gap between them, which is the exact shape this script exists to remove one
    // level up; writing it here would be the defect reproduced inside its own fix. Reported as
    // `js/file-system-race` by CodeQL on the first push, which is how it came out.
    writeFileSync(absolute, recordStub({ id, title, today, issue }), { flag: 'wx' });
  } catch (error) {
    if (error?.code === 'EEXIST') {
      console.error(`${file} already exists — refusing to overwrite a record.`);
      return 1;
    }
    throw error;
  }
  console.log(`${id}\n${file}`);
  return 0;
}

// Compared as resolved PATHS, not as a `file://` string: the string form is false whenever the path
// holds a character a URL escapes — a space, a `#`, anything non-ASCII — and it fails toward
// silence, exiting 0 without running `main`.
if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  process.exit(main(process.argv.slice(2)));
}
