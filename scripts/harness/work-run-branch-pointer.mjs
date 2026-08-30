const OBJECT_OID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const LEGACY_KEYS = ['branch', 'runId'];
const CURRENT_KEYS = [
  'branch',
  'branchEpoch',
  'initialHead',
  'repository',
  'runId',
  'schemaVersion',
];

function hasExactKeys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected);
}

export function assertBranchClaimIdentity(identity) {
  const epochStatus =
    identity?.branchEpochStatus ?? (identity?.branchEpoch === null ? 'unavailable' : 'present');
  const valid =
    identity &&
    typeof identity.repository === 'string' &&
    identity.repository.length > 0 &&
    !identity.repository.includes('\0') &&
    (identity.branchEpoch === null ||
      (typeof identity.branchEpoch === 'string' && /^[0-9a-f]{64}$/.test(identity.branchEpoch))) &&
    ['present', 'expired', 'unavailable'].includes(epochStatus) &&
    typeof identity.headCommit === 'string' &&
    OBJECT_OID_PATTERN.test(identity.headCommit);
  if (!valid) {
    throw new Error('work-run claim requires a repository and current HEAD commit identity');
  }
}

export function createBranchPointer(branch, runId, identity) {
  assertBranchClaimIdentity(identity);
  if ((identity.branchEpochStatus ?? 'present') !== 'present' || identity.branchEpoch === null) {
    throw new Error('work-run claim requires a local branch creation witness');
  }
  return {
    schemaVersion: 1,
    branch,
    runId,
    repository: identity.repository,
    branchEpoch: identity.branchEpoch,
    initialHead: identity.headCommit,
  };
}

export function branchPointerReuse(pointer, branch, identity) {
  assertBranchClaimIdentity(identity);
  if (hasExactKeys(pointer, LEGACY_KEYS)) {
    return { reusable: false, migrate: false };
  }
  const current =
    hasExactKeys(pointer, CURRENT_KEYS) &&
    pointer.schemaVersion === 1 &&
    pointer.branch === branch &&
    typeof pointer.runId === 'string' &&
    pointer.repository === identity.repository &&
    typeof pointer.branchEpoch === 'string' &&
    /^[0-9a-f]{64}$/.test(pointer.branchEpoch) &&
    typeof pointer.initialHead === 'string' &&
    OBJECT_OID_PATTERN.test(pointer.initialHead);
  if (!current) return { reusable: false, migrate: false };
  const epochStatus =
    identity.branchEpochStatus ?? (identity.branchEpoch === null ? 'unavailable' : 'present');
  if (epochStatus === 'expired') {
    throw new Error('work-run branch creation witness expired; branch continuity is unverifiable');
  }
  if (epochStatus === 'unavailable') {
    throw new Error('work-run branch continuity is unverifiable without a local creation witness');
  }
  return {
    reusable: pointer.branchEpoch === identity.branchEpoch,
    migrate: false,
  };
}

export function readReusableBranchRun({
  pointerPath,
  pointerOwner,
  branch,
  identity,
  statePath,
  readRun,
}) {
  assertBranchClaimIdentity(identity);
  if (!existsSync(pointerPath)) return null;
  const pointer = readJson(pointerPath, pointerOwner);
  if (!existsSync(statePath(pointer.runId))) return null;
  const run = readRun(pointer.runId);
  if (['abandoned', 'excluded'].includes(reduceWorkRun(run.events).status)) return null;
  const decision = branchPointerReuse(pointer, branch, identity);
  if (!decision.reusable) return null;
  return run;
}
import { existsSync } from 'node:fs';

import { reduceWorkRun } from './work-run-contract.mjs';
import { readJson } from './work-run-json-store.mjs';
