import { createHash } from 'node:crypto';
import { closeSync, existsSync, openSync, readFileSync, readSync } from 'node:fs';
import path from 'node:path';

import { git, gitBytes, sharedGitOptions } from './work-run-git-command.mjs';
import { repositoryNameFromGit } from './work-run-git-context.mjs';

export { createGitCommandRuntime, git, gitBytes } from './work-run-git-command.mjs';
export {
  assertLocalBranchSubject,
  lockLocalBranchSubject,
  repoContext,
  repositoryNameFromGit,
} from './work-run-git-context.mjs';
export { openPullRequestNumber, pullRequestHistory } from './work-run-github-pr-lookup.mjs';

const MAX_CUTOVER_COMPARE_FILES = 299;
const MAX_REFLOG_ENTRY_BYTES = 4 * 1024;
const OBJECT_OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

function digestCanonicalChanges(records) {
  const normalized = records
    .map(({ status, oldPath, newPath, oldMode, newMode, oldOid, newOid }) => ({
      status,
      oldPath,
      newPath,
      oldMode,
      newMode,
      oldOid,
      newOid,
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), 'en'));
  const identities = normalized.map(({ status, oldPath, newPath }) =>
    JSON.stringify([status, oldPath, newPath]),
  );
  if (new Set(identities).size !== identities.length) {
    throw new Error('topic change contains duplicate normalized identities');
  }
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

function compareTreeEntries(entries, label) {
  if (!Array.isArray(entries)) throw new Error(`GitHub ${label} tree is incomplete`);
  const result = new Map();
  for (const entry of entries) {
    const valid =
      entry &&
      typeof entry.path === 'string' &&
      entry.path.length > 0 &&
      !entry.path.includes('\0') &&
      /^[0-7]{6}$/.test(entry.mode ?? '') &&
      ['blob', 'commit'].includes(entry.type) &&
      OBJECT_OID_PATTERN.test(entry.sha ?? '') &&
      !result.has(entry.path);
    if (!valid) throw new Error(`GitHub ${label} tree contains an invalid entry`);
    result.set(entry.path, { mode: entry.mode, oid: entry.sha });
  }
  return result;
}

function comparePaths(file) {
  const moved = ['renamed', 'copied'].includes(file.status);
  const oldPath = file.status === 'added' ? null : moved ? file.previous_filename : file.filename;
  const newPath = file.status === 'removed' ? null : file.filename;
  if (moved && (typeof oldPath !== 'string' || oldPath.length === 0 || oldPath.includes('\0'))) {
    throw new Error('GitHub compare move lacks its previous path');
  }
  return { oldPath, newPath };
}

function canonicalChange(status, oldPath, newPath, oldEntry, newEntry) {
  return {
    status,
    oldPath,
    newPath,
    oldMode: oldEntry?.mode ?? null,
    newMode: newEntry?.mode ?? null,
    oldOid: oldEntry?.oid ?? null,
    newOid: newEntry?.oid ?? null,
  };
}

const COMPARE_STATUS = new Map([
  ['added', 'A'],
  ['changed', 'T'],
  ['copied', 'C'],
  ['modified', 'M'],
  ['removed', 'D'],
  ['renamed', 'R'],
]);

export function topicChangeDigestFromCompareFiles(files, { baseEntries, headEntries } = {}) {
  if (!Array.isArray(files) || files.length > MAX_CUTOVER_COMPARE_FILES) {
    throw new Error(`GitHub compare file budget exceeds ${MAX_CUTOVER_COMPARE_FILES}`);
  }
  const baseTree = compareTreeEntries(baseEntries, 'base');
  const headTree = compareTreeEntries(headEntries, 'head');
  const records = files.map((file) => {
    if (!file || typeof file.filename !== 'string' || !COMPARE_STATUS.has(file.status)) {
      throw new Error('GitHub compare contains an invalid file projection');
    }
    const { oldPath, newPath } = comparePaths(file);
    const oldEntry = oldPath === null ? null : baseTree.get(oldPath);
    const newEntry = newPath === null ? null : headTree.get(newPath);
    if ((oldPath !== null && !oldEntry) || (newPath !== null && !newEntry)) {
      throw new Error('GitHub compare lacks a matching base/head tree identity');
    }
    if (newEntry !== null && file.sha !== newEntry.oid) {
      throw new Error('GitHub compare contains an invalid file object identity');
    }
    return canonicalChange(COMPARE_STATUS.get(file.status), oldPath, newPath, oldEntry, newEntry);
  });
  return digestCanonicalChanges(records);
}

function parseRawChange(fields, index) {
  const metadata = /^:(\d{6}) (\d{6}) ([0-9a-f]+) ([0-9a-f]+) ([ACDMRT])(\d*)$/.exec(fields[index]);
  if (!metadata) throw new Error('local topic change projection is invalid');
  const [, oldMode, newMode, oldOid, newOid, status] = metadata;
  const firstPath = fields[index + 1];
  const moved = ['R', 'C'].includes(status);
  const secondPath = moved ? fields[index + 2] : null;
  if (!firstPath || (moved && !secondPath)) {
    throw new Error('local topic change projection is incomplete');
  }
  const oldEntry = status === 'A' ? null : { mode: oldMode, oid: oldOid };
  const newEntry = status === 'D' ? null : { mode: newMode, oid: newOid };
  if ([oldEntry, newEntry].some((entry) => entry && !OBJECT_OID_PATTERN.test(entry.oid))) {
    throw new Error('local topic change object identity is invalid');
  }
  const record = canonicalChange(
    status,
    status === 'A' ? null : firstPath,
    status === 'D' ? null : (secondPath ?? firstPath),
    oldEntry,
    newEntry,
  );
  return { record, consumed: moved ? 3 : 2 };
}

export function topicChangeDigestFromGit(root, base, head) {
  const fields = gitBytes(root, [
    'diff',
    '--raw',
    '-z',
    '--find-renames',
    '--find-copies',
    '--no-abbrev',
    `${base}..${head}`,
  ])
    .toString('utf8')
    .split('\0');
  if (fields.at(-1) === '') fields.pop();
  const records = [];
  for (let index = 0; index < fields.length;) {
    const parsed = parseRawChange(fields, index);
    records.push(parsed.record);
    index += parsed.consumed;
  }
  return digestCanonicalChanges(records);
}

function trailerDigest(root, base, head, options) {
  const messages = git(root, ['log', '--format=%H%x00%B%x00', `${base}..${head}`], options);
  return createHash('sha256').update(messages).digest('hex');
}

export function createRebaseProof(root, baseRef, oldHead, newHead = 'HEAD', options = {}) {
  const gitOptions = sharedGitOptions(options);
  const newBase = git(root, ['rev-parse', `${baseRef}^{commit}`], gitOptions);
  const resolvedOldHead = git(root, ['rev-parse', `${oldHead}^{commit}`], gitOptions);
  const resolvedNewHead = git(root, ['rev-parse', `${newHead}^{commit}`], gitOptions);
  const oldBase = git(root, ['merge-base', resolvedOldHead, newBase], gitOptions);
  const oldPatch = gitBytes(
    root,
    ['diff', '--binary', `${oldBase}..${resolvedOldHead}`],
    gitOptions,
  );
  const newPatch = gitBytes(
    root,
    ['diff', '--binary', `${newBase}..${resolvedNewHead}`],
    gitOptions,
  );
  const oldDigest = createHash('sha256').update(oldPatch).digest('hex');
  const newDigest = createHash('sha256').update(newPatch).digest('hex');
  if (oldDigest !== newDigest) {
    throw new Error('rebase result does not preserve the authorized topic change');
  }
  return {
    oldBase,
    oldHead: resolvedOldHead,
    newBase,
    newHead: resolvedNewHead,
    patchDigest: newDigest,
  };
}

export function currentIdentity(root, branch, baseRef, headRef = 'HEAD', options = {}) {
  const gitOptions = sharedGitOptions(options);
  const headCommit = git(root, ['rev-parse', `${headRef}^{commit}`], gitOptions);
  const commitOids = git(root, ['rev-list', '--reverse', `${baseRef}..${headCommit}`], gitOptions)
    .split('\n')
    .filter(Boolean);
  return {
    repository: repositoryNameFromGit(root, gitOptions),
    branch,
    baseCommit: git(root, ['rev-parse', `${baseRef}^{commit}`], gitOptions),
    headCommit,
    headTree: git(root, ['rev-parse', `${headCommit}^{tree}`], gitOptions),
    commitOids,
    trailerDigest: trailerDigest(root, baseRef, headCommit, gitOptions),
    ownerFingerprint: createHash('sha256')
      .update(readFileSync(path.join(root, 'scripts/harness/work-run-contract.mjs')))
      .digest('hex'),
  };
}

function branchEpoch(root, branch, options) {
  git(root, ['check-ref-format', `refs/heads/${branch}`], options);
  const logPath = git(
    root,
    ['rev-parse', '--path-format=absolute', '--git-path', `logs/refs/heads/${branch}`],
    options,
  );
  if (!existsSync(logPath)) {
    try {
      git(root, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], options);
    } catch (error) {
      if (error?.status === 1 || error?.cause?.status === 1) {
        return { value: null, status: 'unavailable' };
      }
      throw error;
    }
    return { value: null, status: 'expired' };
  }
  const descriptor = openSync(logPath, 'r');
  try {
    const buffer = Buffer.alloc(MAX_REFLOG_ENTRY_BYTES + 1);
    const bytesRead = readSync(descriptor, buffer, 0, buffer.length, 0);
    if (bytesRead === 0) return { value: null, status: 'expired' };
    const newline = buffer.subarray(0, bytesRead).indexOf(10);
    if (newline <= 0 || (newline === -1 && bytesRead === buffer.length)) {
      throw new Error('work-run branch reflog identity is missing or oversized');
    }
    const entry = buffer.subarray(0, newline === -1 ? bytesRead : newline);
    const oldOid = /^([0-9a-f]{40}|[0-9a-f]{64}) /.exec(entry.toString('utf8'))?.[1];
    if (!oldOid) throw new Error('work-run branch reflog identity is malformed');
    return {
      value: createHash('sha256').update(entry).digest('hex'),
      status: /^0+$/.test(oldOid) ? 'present' : 'expired',
    };
  } finally {
    closeSync(descriptor);
  }
}

export function currentClaimIdentity(root, branch, headRef = 'HEAD', options = {}) {
  const gitOptions = sharedGitOptions(options);
  const epoch = branchEpoch(root, branch, gitOptions);
  return {
    repository: repositoryNameFromGit(root, gitOptions),
    branchEpoch: epoch.value,
    branchEpochStatus: epoch.status,
    headCommit: git(root, ['rev-parse', `${headRef}^{commit}`], gitOptions),
  };
}
