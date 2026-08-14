import { spawnSync } from 'node:child_process';

import { resolveGitBaseRef, WORKSPACE_ROOT } from './shared.mjs';
import { isDeletedRefUpdate } from './pre-push-updates.mjs';

const OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

function defaultRunCommand(command, args) {
  const result = spawnSync(command, args, {
    cwd: WORKSPACE_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}

export function selectPushBoundBranch({ updates, hookInputProvided, currentBranch, headOid }) {
  if (!currentBranch) return { ok: false, reason: 'HEAD is detached' };
  if (!OBJECT_ID_PATTERN.test(headOid)) return { ok: false, reason: 'HEAD OID is unavailable' };

  if (!hookInputProvided) return { ok: true, branch: currentBranch };
  if (updates.length !== 1) {
    return { ok: false, reason: 'push does not contain exactly one ref update' };
  }

  const [update] = updates;
  if (isDeletedRefUpdate(update)) return { ok: false, reason: 'push deletes the selected ref' };

  const expectedRef = `refs/heads/${currentBranch}`;
  if (update.localRef !== expectedRef) {
    return { ok: false, reason: 'pushed local ref is not the current branch' };
  }
  if (update.remoteRef !== expectedRef) {
    return { ok: false, reason: 'push renames the current branch ref' };
  }
  if (update.localObjectId !== headOid) {
    return { ok: false, reason: 'pushed object does not equal HEAD' };
  }
  return { ok: true, branch: currentBranch };
}

function parseCandidates(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isTrustedCandidate(value, branch) {
  return (
    value !== null &&
    typeof value === 'object' &&
    value.state === 'OPEN' &&
    value.isCrossRepository === false &&
    value.headRefName === branch &&
    typeof value.baseRefName === 'string' &&
    value.baseRefName.length > 0 &&
    typeof value.baseRefOid === 'string' &&
    OBJECT_ID_PATTERN.test(value.baseRefOid)
  );
}

export function resolvePrePushBaseRef({
  updates,
  hookInputProvided,
  currentBranch,
  headOid,
  pushRemoteName = null,
  pushRemoteUrl = null,
  originUrl = null,
  explicitBaseRef = null,
  env = process.env,
  runCommand = defaultRunCommand,
  resolveFallback = resolveGitBaseRef,
}) {
  const explicit = typeof explicitBaseRef === 'string' ? explicitBaseRef.trim() : '';
  if (explicit) {
    return {
      baseRef: resolveFallback(explicit, env),
      source: 'explicit',
      fallbackReason: null,
    };
  }

  const fallback = (fallbackReason) => ({
    baseRef: resolveFallback(null, env),
    source: 'fallback',
    fallbackReason,
  });

  if (
    hookInputProvided &&
    (pushRemoteName !== 'origin' ||
      !pushRemoteUrl ||
      !originUrl ||
      pushRemoteUrl.trim() !== originUrl.trim())
  ) {
    return fallback('push remote did not match the origin repository used for pull request lookup');
  }

  const selected = selectPushBoundBranch({
    updates,
    hookInputProvided,
    currentBranch,
    headOid,
  });
  if (!selected.ok) return fallback(selected.reason);

  const query = runCommand('gh', [
    'pr',
    'list',
    '--state',
    'open',
    '--head',
    selected.branch,
    '--json',
    'baseRefName,baseRefOid,headRefName,state,isCrossRepository',
  ]);
  if (query.status !== 0) return fallback('pull request lookup failed');

  const candidates = parseCandidates(query.stdout);
  if (!candidates) return fallback('pull request lookup returned malformed JSON');
  if (candidates.length === 0) return fallback('no open pull request matched the pushed branch');
  if (candidates.length !== 1)
    return fallback('multiple open pull requests matched the pushed branch');

  const [candidate] = candidates;
  if (!isTrustedCandidate(candidate, selected.branch)) {
    return fallback('pull request candidate identity was not trusted');
  }

  const fullBaseRef = `refs/heads/${candidate.baseRefName}`;
  const validRef = runCommand('git', ['check-ref-format', fullBaseRef]);
  if (validRef.status !== 0) return fallback('pull request base ref name was invalid');

  const objectExists = runCommand('git', ['cat-file', '-e', `${candidate.baseRefOid}^{commit}`]);
  if (objectExists.status !== 0) {
    const fetched = runCommand('git', ['fetch', '--no-tags', 'origin', fullBaseRef]);
    if (fetched.status !== 0) return fallback('pull request base ref fetch failed');

    const fetchedHead = runCommand('git', ['rev-parse', 'FETCH_HEAD^{commit}']);
    if (fetchedHead.status !== 0)
      return fallback('fetched pull request base object was unreadable');
    if (fetchedHead.stdout.trim() !== candidate.baseRefOid) {
      return fallback('fetched base OID did not match the pull request base OID');
    }
  }

  return {
    baseRef: candidate.baseRefOid,
    source: 'pull-request',
    fallbackReason: null,
  };
}

export function createPrePushBasePlan({ baseRef, source, fallbackReason }) {
  return Object.freeze({
    baseRef,
    baseArgs: baseRef ? Object.freeze(['--base-ref', baseRef]) : Object.freeze([]),
    classificationBaseRef: baseRef,
    decisionBaseRef: baseRef,
    receiptBaseRef: baseRef,
    source,
    fallbackReason,
  });
}
