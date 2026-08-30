import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { WorkRunStore } from './work-run-store.mjs';
import { writeImmutableWorkRunReceipt } from './work-run-domain.mjs';
import {
  git,
  repositoryNameFromGit,
  topicChangeDigestFromCompareFiles,
  topicChangeDigestFromGit,
} from './work-run-git.mjs';

const OBJECT_OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

export function buildCutoverMarker({
  repository,
  openPullRequests,
  generatedAt = new Date().toISOString(),
}) {
  if (!repository || !Array.isArray(openPullRequests)) {
    throw new Error('cutover marker needs repository and openPullRequests');
  }
  const normalized = openPullRequests
    .map((pr) => ({
      number: Number(pr.number),
      createdAt: pr.createdAt,
      baseOid: pr.baseOid,
      headOid: pr.headOid,
      identity: structuredClone(pr.identity),
    }))
    .sort((left, right) => left.number - right.number);
  const seen = new Set();
  for (const pr of normalized) {
    if (
      !Number.isInteger(pr.number) ||
      pr.number < 1 ||
      !pr.createdAt ||
      !pr.baseOid ||
      !pr.headOid ||
      !pr.identity
    ) {
      throw new Error('cutover registry contains an incomplete pull request');
    }
    if (seen.has(pr.number)) throw new Error(`cutover registry duplicates PR #${pr.number}`);
    seen.add(pr.number);
  }
  return {
    schemaVersion: 1,
    markerId: 'work-run-v1',
    generatedAt,
    repository,
    openPullRequests: normalized,
  };
}

function githubRunner() {
  const deadlineAt = Date.now() + 15_000;
  return (args) => {
    const result = spawnSync('gh', args, {
      encoding: 'utf8',
      timeout: Math.max(1, deadlineAt - Date.now()),
      maxBuffer: 8 * 1024 * 1024,
    });
    if (result.error?.code === 'ETIMEDOUT') {
      throw new Error('GitHub open-PR query timed out after 15 seconds');
    }
    if (result.status !== 0) {
      throw new Error(`GitHub open-PR query failed: ${(result.stderr ?? '').trim()}`);
    }
    return JSON.parse(result.stdout);
  };
}

function paged(runGitHub, endpoint, label) {
  const pages = runGitHub(['api', '--paginate', '--slurp', endpoint]);
  if (!Array.isArray(pages) || pages.some((page) => !Array.isArray(page))) {
    throw new Error(`${label} pagination is incomplete`);
  }
  return pages.flat();
}

function githubTree(runGitHub, repository, treeOid, prNumber) {
  if (!OBJECT_OID_PATTERN.test(treeOid ?? '')) {
    throw new Error(`GitHub tree identity for PR #${prNumber} is incomplete`);
  }
  const tree = runGitHub(['api', `/repos/${repository}/git/trees/${treeOid}?recursive=1`]);
  if (tree?.truncated || !Array.isArray(tree?.tree)) {
    throw new Error(`GitHub tree identity for PR #${prNumber} is truncated or incomplete`);
  }
  return tree.tree;
}

function trailerDigest(commits) {
  return createHash('sha256').update(JSON.stringify(commits)).digest('hex');
}

function githubPullIdentity(runGitHub, repository, root, pr) {
  const commits = paged(
    runGitHub,
    `/repos/${repository}/pulls/${pr.number}/commits?per_page=100`,
    `GitHub commit pagination for PR #${pr.number}`,
  );
  if (commits.length === 0 || commits.at(-1)?.sha !== pr.head?.sha) {
    throw new Error(`GitHub commit identity for PR #${pr.number} is incomplete`);
  }
  const comparison = runGitHub([
    'api',
    `/repos/${repository}/compare/${pr.base?.sha}...${pr.head?.sha}`,
  ]);
  if (comparison?.base_commit?.sha !== pr.base?.sha || !Array.isArray(comparison.files)) {
    throw new Error(`GitHub compare identity for PR #${pr.number} is incomplete`);
  }
  const baseEntries = githubTree(
    runGitHub,
    repository,
    comparison.base_commit?.commit?.tree?.sha,
    pr.number,
  );
  const headEntries = githubTree(
    runGitHub,
    repository,
    commits.at(-1)?.commit?.tree?.sha,
    pr.number,
  );
  const projected = commits.map((commit) => ({
    oid: commit.sha,
    message: commit.commit?.message ?? '',
  }));
  return {
    repository,
    branch: pr.head?.ref,
    baseCommit: pr.base?.sha,
    headCommit: pr.head?.sha,
    headTree: commits.at(-1)?.commit?.tree?.sha,
    changeDigest: topicChangeDigestFromCompareFiles(comparison.files, { baseEntries, headEntries }),
    commitOids: commits.map((commit) => commit.sha),
    trailerDigest: trailerDigest(projected),
    ownerFingerprint: createHash('sha256')
      .update(readFileSync(path.join(root, 'scripts/harness/work-run-contract.mjs')))
      .digest('hex'),
  };
}

export function githubOpenPullRequests(repository, root) {
  const runGitHub = githubRunner();
  const pulls = paged(
    runGitHub,
    `/repos/${repository}/pulls?state=open&per_page=100`,
    'GitHub open-PR',
  );
  if (pulls.length > 10) throw new Error('cutover registry exceeds the 10-PR budget');
  return pulls.map((pr) => ({
    number: pr.number,
    createdAt: pr.created_at,
    baseOid: pr.base?.sha,
    headOid: pr.head?.sha,
    identity: githubPullIdentity(runGitHub, repository, root, pr),
  }));
}

export function planCutover({ root, repository = repositoryNameFromGit(root), output }) {
  const openPullRequests = githubOpenPullRequests(repository, root);
  const marker = buildCutoverMarker({ repository, openPullRequests });
  const target = output ?? path.join(root, '.agents/evals/work-runs/cutover-v1.json');
  writeFileSync(target, `${JSON.stringify(marker, null, 2)}\n`);
  return { status: 'planned', output: target, count: openPullRequests.length };
}

function localCutoverIdentity(contextRoot, targetRoot, marker, entry, targetBranch) {
  const commitOids = git(targetRoot, [
    'rev-list',
    '--reverse',
    `${entry.baseOid}..${entry.headOid}`,
  ])
    .split('\n')
    .filter(Boolean);
  const commits = commitOids.map((oid) => ({
    oid,
    message: git(targetRoot, ['show', '-s', '--format=%B', oid]),
  }));
  return {
    repository: marker.repository,
    branch: targetBranch,
    baseCommit: entry.baseOid,
    headCommit: entry.headOid,
    headTree: git(targetRoot, ['rev-parse', 'HEAD^{tree}']),
    changeDigest: topicChangeDigestFromGit(targetRoot, entry.baseOid, entry.headOid),
    commitOids,
    trailerDigest: trailerDigest(commits),
    ownerFingerprint: createHash('sha256')
      .update(readFileSync(path.join(contextRoot, 'scripts/harness/work-run-contract.mjs')))
      .digest('hex'),
  };
}

function cutoverReceipt(marker, entry, prNumber) {
  return {
    schemaVersion: 1,
    disposition: 'pre-cutover',
    reason: 'registered-open-pr',
    runId: `pre-cutover-pr-${prNumber}`,
    generation: 0,
    revision: 0,
    prNumber,
    markerId: marker.markerId,
    identity: structuredClone(entry.identity),
    timestamps: { claimedAt: null, readyAt: entry.createdAt },
  };
}

export function sealCutover({ contextRoot, targetRoot, prNumber }) {
  const marker = JSON.parse(
    readFileSync(path.join(contextRoot, '.agents/evals/work-runs/cutover-v1.json'), 'utf8'),
  );
  const entry = marker.openPullRequests.find((candidate) => candidate.number === prNumber);
  if (!entry) throw new Error(`PR #${prNumber} is absent from the cutover registry`);
  const targetBranch = git(targetRoot, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  if (git(targetRoot, ['rev-parse', 'HEAD^{commit}']) !== entry.headOid) {
    throw new Error(`PR #${prNumber} target head does not match the registry`);
  }
  const computed = localCutoverIdentity(contextRoot, targetRoot, marker, entry, targetBranch);
  if (JSON.stringify(computed) !== JSON.stringify(entry.identity)) {
    throw new Error(`PR #${prNumber} sealed identity does not match the registry`);
  }
  const commonDir = git(targetRoot, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
  const store = new WorkRunStore({ root: targetRoot, gitCommonDir: commonDir });
  const receipt = cutoverReceipt(marker, entry, prNumber);
  const receiptPath = store.receiptPath(receipt.runId, 0, 0);
  writeImmutableWorkRunReceipt(receiptPath, receipt);
  return { status: 'sealed', receiptPath, prNumber };
}
