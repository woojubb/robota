import { spawnSync } from 'node:child_process';

import { commandTimeout, createGitCommandRuntime } from './work-run-git-command.mjs';
import { repositoryNameFromGit } from './work-run-git-context.mjs';

const DEFAULT_COMMAND_TIMEOUT_MS = 10_000;

function openPullRequestArgs(repository, branch) {
  const owner = repository.split('/')[0];
  return [
    'api',
    '-X',
    'GET',
    '-f',
    'state=open',
    '-f',
    `head=${owner}:${branch}`,
    '-f',
    'per_page=2',
    `/repos/${repository}/pulls`,
  ];
}

function unavailableRepositoryContext(error) {
  return {
    status: 'unavailable',
    reason: /timed out|deadline|budget/u.test(error.message)
      ? 'github-repository-context-timeout'
      : 'github-repository-context-failed',
  };
}

function parseOpenPullRequest(result) {
  if (result?.error?.code === 'ETIMEDOUT' || result?.timedOut === true) {
    return { status: 'unavailable', reason: 'github-open-pr-query-timeout' };
  }
  if (result.error || result.status !== 0) {
    return { status: 'unavailable', reason: 'github-open-pr-query-failed' };
  }
  const pulls = JSON.parse(result.stdout);
  if (!Array.isArray(pulls) || pulls.length > 1) throw new Error('ambiguous response');
  if (pulls.length === 0) return { status: 'none' };
  const number = Number(pulls[0].number);
  if (!Number.isInteger(number) || number < 1) throw new Error('invalid PR');
  return { status: 'open', number, createdAt: pulls[0].created_at ?? null };
}

export function openPullRequestNumber(root, branch, options = {}) {
  const runtime = createGitCommandRuntime(options);
  let repository = options.repository;
  if (!repository) {
    try {
      repository = repositoryNameFromGit(root, { run: options.runGit, runtime });
    } catch (error) {
      return unavailableRepositoryContext(error);
    }
  }
  let timeout;
  try {
    timeout = commandTimeout(
      runtime,
      'github open PR query',
      DEFAULT_COMMAND_TIMEOUT_MS,
      'work-run command',
    );
  } catch {
    return { status: 'unavailable', reason: 'github-open-pr-query-deadline-exceeded' };
  }
  const result = (options.run ?? spawnSync)('gh', openPullRequestArgs(repository, branch), {
    cwd: root,
    encoding: 'utf8',
    timeout,
    maxBuffer: 1024 * 1024,
  });
  try {
    return parseOpenPullRequest(result);
  } catch {
    return { status: 'unavailable', reason: 'github-open-pr-response-invalid' };
  }
}

function pullRequestHistoryArgs(repository, branch) {
  const owner = repository.split('/')[0];
  return [
    'api',
    '-X',
    'GET',
    '-f',
    'state=all',
    '-f',
    `head=${owner}:${branch}`,
    '-f',
    'per_page=1',
    `/repos/${repository}/pulls`,
  ];
}

function parsePullRequestHistory(result) {
  if (result?.error?.code === 'ETIMEDOUT' || result?.timedOut === true) {
    return { status: 'unavailable', reason: 'github-pr-history-query-timeout' };
  }
  if (result.error || result.status !== 0) {
    return { status: 'unavailable', reason: 'github-pr-history-query-failed' };
  }
  const pulls = JSON.parse(result.stdout);
  if (!Array.isArray(pulls) || pulls.length > 1) throw new Error('invalid response');
  return pulls.length === 0
    ? { status: 'none' }
    : { status: 'exists', number: pulls[0]?.number ?? null, state: pulls[0]?.state ?? null };
}

function unavailablePullRequestHistory(error) {
  const timeout = /timed out|deadline|budget/u.test(error.message);
  return {
    status: 'unavailable',
    reason: timeout
      ? 'github-pr-history-query-deadline-exceeded'
      : 'github-pr-history-response-invalid',
  };
}

export function pullRequestHistory(root, branch, options = {}) {
  const runtime = createGitCommandRuntime(options);
  try {
    const repository =
      options.repository ?? repositoryNameFromGit(root, { run: options.runGit, runtime });
    const timeout = commandTimeout(
      runtime,
      'github PR history query',
      DEFAULT_COMMAND_TIMEOUT_MS,
      'work-run command',
    );
    const result = (options.run ?? spawnSync)('gh', pullRequestHistoryArgs(repository, branch), {
      cwd: root,
      encoding: 'utf8',
      timeout,
      maxBuffer: 1024 * 1024,
    });
    return parsePullRequestHistory(result);
  } catch (error) {
    return unavailablePullRequestHistory(error);
  }
}
