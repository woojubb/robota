#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

import { fetchAllPages } from './github-api.mjs';

/**
 * Select the pull request that introduced one integration-branch commit.
 *
 * Pull-request identity is an API fact: the expected base and the PR's exact merge commit must both
 * match. Commit subjects are intentionally absent from this contract because they are presentation
 * text and differ between squash and two-parent merges.
 */

function normalizedPull(pull) {
  const oid = pull?.mergeCommit?.oid ?? pull?.merge_commit_sha;
  const baseRefName = pull?.baseRefName ?? pull?.base?.ref;
  const merged = pull?.state === 'MERGED' || (pull?.state === 'closed' && pull?.merged_at);
  if (
    !Number.isSafeInteger(pull?.number) ||
    pull.number < 1 ||
    !merged ||
    typeof baseRefName !== 'string' ||
    !/^[0-9a-f]{40}$/i.test(oid ?? '')
  ) {
    return null;
  }
  return {
    number: pull.number,
    baseRefName,
    mergeCommit: { oid: oid.toLowerCase() },
    title: typeof pull.title === 'string' ? pull.title : '',
    body: typeof pull.body === 'string' ? pull.body : '',
  };
}

export function selectLandingPull({ landingOid, baseRefName, pullNumber, pulls }) {
  const expectedOid = String(landingOid ?? '').toLowerCase();
  const matches = associatedPulls({ baseRefName, pullNumber, pulls }).filter(
    (pull) => pull.mergeCommit.oid === expectedOid,
  );
  if (matches.length !== 1) {
    throw new Error(
      `landing pull for ${baseRefName}@${expectedOid || '(missing oid)'} is ` +
        (matches.length === 0 ? 'unavailable' : `ambiguous (${matches.length} matches)`),
    );
  }
  return matches[0];
}

function associatedPulls({ baseRefName, pullNumber, pulls }) {
  return Array.isArray(pulls)
    ? pulls
        .map(normalizedPull)
        .filter(Boolean)
        .filter(
          (pull) =>
            pull.baseRefName === baseRefName &&
            (pullNumber === undefined || pull.number === pullNumber),
        )
    : [];
}

export function selectAssociatedPull({ landingOid, baseRefName, pulls }) {
  const matches = associatedPulls({ baseRefName, pulls });
  if (matches.length !== 1) {
    throw new Error(
      `associated pull for ${baseRefName}@${String(landingOid ?? '').toLowerCase() || '(missing oid)'} is ` +
        (matches.length === 0 ? 'unavailable' : `ambiguous (${matches.length} matches)`),
    );
  }
  return matches[0];
}

function ghRunner(args) {
  return spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
}

export function readLandingPull({
  repository,
  landingOid,
  baseRefName,
  pullNumber,
  runGh = ghRunner,
}) {
  if (!/^[^/\s]+\/[^/\s]+$/.test(repository ?? '')) {
    throw new Error('landing pull repository must be owner/name');
  }
  if (!/^[0-9a-f]{40}$/i.test(landingOid ?? '')) {
    throw new Error('landing pull commit must be a full 40-hex OID');
  }
  if (!/^(?!.*\.\.)[A-Za-z0-9._/-]+$/.test(baseRefName ?? '')) {
    throw new Error('landing pull base must be a branch name');
  }
  const endpoint = `repos/${repository}/commits/${landingOid}/pulls`;
  const { records } = fetchAllPages(endpoint, { runner: runGh });
  return selectLandingPull({ landingOid, baseRefName, pullNumber, pulls: records });
}

export function readAssociatedPull({ repository, landingOid, baseRefName, runGh = ghRunner }) {
  if (!/^[^/\s]+\/[^/\s]+$/.test(repository ?? '')) {
    throw new Error('associated pull repository must be owner/name');
  }
  if (!/^[0-9a-f]{40}$/i.test(landingOid ?? '')) {
    throw new Error('associated pull commit must be a full 40-hex OID');
  }
  if (!/^(?!.*\.\.)[A-Za-z0-9._/-]+$/.test(baseRefName ?? '')) {
    throw new Error('associated pull base must be a branch name');
  }
  const endpoint = `repos/${repository}/commits/${landingOid}/pulls`;
  const { records } = fetchAllPages(endpoint, { runner: runGh });
  return selectAssociatedPull({ landingOid, baseRefName, pulls: records });
}
