/**
 * The GitHub-issue half of `allocate-work-item-id.mjs`: reading, creating and closing the issue a
 * newly allocated work item is bound to.
 *
 * Its own module because it is the only part of the allocator that leaves the machine. Every function
 * here shells out to `gh` and fails for network and authentication reasons the ID arithmetic never
 * can, so keeping the two apart makes their failure modes separable. Splitting also keeps
 * `allocate-work-item-id.mjs` inside the size its frozen baseline holds (INFRA-181) — moved, never
 * raised.
 *
 * Every exported name is re-exported from `allocate-work-item-id.mjs`, so no consumer changes.
 */
import { spawnSync } from 'node:child_process';

import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);

const ISSUE_REPOSITORY = 'woojubb/robota';
const REQUIRED_NEW_ISSUE_LABELS = ['enhancement', 'status:needs-triage'];

const validIssueNumber = (value) =>
  typeof value === 'string' && /^[1-9]\d*$/.test(value) ? value : null;

/** Read issue numbers and titles for exact-title reuse before creating a duplicate. */
export function listIssues({ run = defaultIssueList } = {}) {
  const result = run();
  if (result === null) return null;
  return result
    .map((issue) => ({ number: String(issue.number), title: String(issue.title ?? '') }))
    .filter((issue) => validIssueNumber(issue.number) !== null);
}

function defaultIssueList() {
  const result = spawnSync(
    'gh',
    [
      'issue',
      'list',
      '--repo',
      ISSUE_REPOSITORY,
      '--state',
      'all',
      '--limit',
      '1000',
      '--json',
      'number,title',
    ],
    { cwd: WORKSPACE_ROOT, encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
  );
  if (result.status !== 0) return null;
  try {
    return JSON.parse(result.stdout ?? '[]');
  } catch {
    return null;
  }
}

function defaultIssueView(number) {
  const result = spawnSync(
    'gh',
    ['issue', 'view', number, '--repo', ISSUE_REPOSITORY, '--json', 'number,title,labels'],
    { cwd: WORKSPACE_ROOT, encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024 },
  );
  if (result.status !== 0) return null;
  try {
    return JSON.parse(result.stdout ?? '{}');
  } catch {
    return null;
  }
}

function defaultCloseIssue(number) {
  const closed = spawnSync(
    'gh',
    [
      'issue',
      'close',
      number,
      '--repo',
      ISSUE_REPOSITORY,
      '--reason',
      'not planned',
      '--comment',
      'Closed automatically because work-item ID allocation could not complete safely.',
    ],
    { cwd: WORKSPACE_ROOT, encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024 },
  );
  return closed.status === 0;
}

/** Close an Issue created by this allocator when a later safety check refuses the allocation. */
export function closeCreatedIssue(number, closeIssue = defaultCloseIssue) {
  const valid = validIssueNumber(String(number));
  if (valid === null) throw new Error('cannot clean up an invalid GitHub issue number');
  return closeIssue(valid);
}

function defaultCreateIssue(title) {
  const body = [
    '## What was observed',
    '',
    title,
    '',
    '## Expected outcome',
    '',
    'Track this requested change as the canonical external work item before creating its Task/spec identifier.',
    '',
    '## Location / context',
    '',
    'Created by `allocate-work-item-id.mjs`; duplicate search was performed by exact title before creation.',
    '',
    '## Duplicate search',
    '',
    'Exact-title search found no existing Issue.',
  ].join('\n');
  const created = spawnSync(
    'gh',
    [
      'issue',
      'create',
      '--repo',
      ISSUE_REPOSITORY,
      '--title',
      title,
      '--body',
      body,
      ...REQUIRED_NEW_ISSUE_LABELS.flatMap((label) => ['--label', label]),
    ],
    { cwd: WORKSPACE_ROOT, encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024 },
  );
  if (created.status !== 0) return null;
  const number = /\/issues\/(\d+)\b/.exec(created.stdout ?? '')?.[1] ?? null;
  if (number === null) return null;
  const verified = defaultIssueView(number);
  if (
    verified === null ||
    !REQUIRED_NEW_ISSUE_LABELS.every((label) =>
      (verified.labels ?? []).some((entry) => entry.name === label),
    )
  ) {
    const cleanedUp = closeCreatedIssue(number);
    throw new Error(
      `allocate-work-item-id: created issue #${number}, but required labels could not be verified; ` +
        `refusing to allocate${cleanedUp ? ' (the newly created Issue was closed)' : ' (automatic cleanup failed; close the Issue manually)'}`,
    );
  }
  return { number, title };
}

/** Resolve an existing Issue or create one, without writing a Task/spec before resolution succeeds. */
export function resolveIssueNumber({
  requestedIssue = null,
  title = '',
  dryRun = false,
  viewIssue = defaultIssueView,
  issueList = () => defaultIssueList(),
  createIssue = defaultCreateIssue,
} = {}) {
  const requested = requestedIssue === null ? null : validIssueNumber(String(requestedIssue));
  if (requestedIssue !== null && requested === null) {
    throw new Error('`--issue` must be a positive GitHub issue number');
  }
  if (requested !== null) {
    const issue = viewIssue(requested);
    if (issue === null || String(issue.number) !== requested) {
      throw new Error(`GitHub issue #${requested} could not be resolved in ${ISSUE_REPOSITORY}`);
    }
    return { number: requested, source: 'existing' };
  }
  const normalizedTitle = String(title).trim();
  if (normalizedTitle === '') throw new Error('a title is required when --issue is omitted');
  const listed = listIssues({ run: issueList });
  if (listed === null) throw new Error('GitHub issue list could not be read; refusing to allocate');
  const matches = listed.filter((issue) => issue.title === normalizedTitle);
  if (matches.length > 1) {
    throw new Error(
      `several GitHub Issues have the exact title "${normalizedTitle}"; pass --issue explicitly`,
    );
  }
  if (matches.length === 1) return { number: matches[0].number, source: 'existing-title' };
  if (dryRun)
    throw new Error('--dry-run cannot create a missing GitHub Issue; pass --issue explicitly');
  const created = createIssue(normalizedTitle);
  if (created === null || validIssueNumber(String(created.number)) === null) {
    throw new Error(
      'GitHub Issue creation did not return a valid issue number; refusing to allocate',
    );
  }
  return { number: String(created.number), source: 'created' };
}
