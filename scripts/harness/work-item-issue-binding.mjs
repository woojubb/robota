/**
 * The GitHub-issue half of `allocate-work-item-id.mjs`: resolving the EXISTING issue a work item is
 * bound to, by number or by an exact title match. It never creates or closes one — a person opens
 * the Issue (`gh issue create` or the web UI) before allocating against it.
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

/**
 * Resolve an EXISTING Issue only. This allocator never creates one (issue-registration policy,
 * 2026-09): a finding is recorded in `.agents/learn.md` as it is noticed, and a GitHub Issue is
 * opened by a person — with `gh issue create` or the web UI — only when the work is ready to be
 * tracked externally. Auto-creating one here, silently, on every title that had no exact match was
 * the mechanism driving Issue-count growth the policy exists to stop.
 */
export function resolveIssueNumber({
  requestedIssue = null,
  title = '',
  viewIssue = defaultIssueView,
  issueList = () => defaultIssueList(),
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
  throw new Error(
    `no open or closed GitHub Issue titled "${normalizedTitle}" was found in ${ISSUE_REPOSITORY}. ` +
      'This allocator no longer files one automatically — open it yourself (`gh issue create`) and ' +
      'pass its number with --issue, or record the finding in .agents/learn.md instead of allocating ' +
      'a Task for it yet.',
  );
}
