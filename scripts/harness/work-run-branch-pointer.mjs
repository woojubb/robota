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
  const valid =
    identity &&
    typeof identity.repository === 'string' &&
    identity.repository.length > 0 &&
    !identity.repository.includes('\0') &&
    typeof identity.branchEpoch === 'string' &&
    /^[0-9a-f]{64}$/.test(identity.branchEpoch) &&
    typeof identity.headCommit === 'string' &&
    OBJECT_OID_PATTERN.test(identity.headCommit);
  if (!valid) {
    throw new Error('work-run claim requires a repository and current HEAD commit identity');
  }
}

export function createBranchPointer(branch, runId, identity) {
  assertBranchClaimIdentity(identity);
  return {
    schemaVersion: 1,
    branch,
    runId,
    repository: identity.repository,
    branchEpoch: identity.branchEpoch,
    initialHead: identity.headCommit,
  };
}

export function branchPointerReuse(pointer, branch, identity, isAncestor) {
  assertBranchClaimIdentity(identity);
  if (hasExactKeys(pointer, LEGACY_KEYS)) {
    return { reusable: pointer.branch === branch, migrate: pointer.branch === branch };
  }
  const current =
    hasExactKeys(pointer, CURRENT_KEYS) &&
    pointer.schemaVersion === 1 &&
    pointer.branch === branch &&
    typeof pointer.runId === 'string' &&
    pointer.repository === identity.repository &&
    pointer.branchEpoch === identity.branchEpoch &&
    typeof pointer.initialHead === 'string' &&
    OBJECT_OID_PATTERN.test(pointer.initialHead);
  if (!current) return { reusable: false, migrate: false };
  if (typeof isAncestor !== 'function') {
    throw new Error('work-run branch pointer reuse requires an ancestry verifier');
  }
  return {
    reusable: isAncestor(pointer.initialHead, identity.headCommit),
    migrate: false,
  };
}

export function readReusableBranchRun({
  pointerPath,
  pointerOwner,
  branch,
  identity,
  isAncestor,
  statePath,
  readRun,
}) {
  assertBranchClaimIdentity(identity);
  if (!existsSync(pointerPath)) return null;
  const pointer = readJson(pointerPath, pointerOwner);
  if (!existsSync(statePath(pointer.runId))) return null;
  const run = readRun(pointer.runId);
  if (['abandoned', 'excluded'].includes(reduceWorkRun(run.events).status)) return null;
  const decision = branchPointerReuse(pointer, branch, identity, isAncestor);
  if (!decision.reusable) return null;
  // Only the exact pre-identity shape gets this one-way compatibility migration.
  if (decision.migrate) {
    atomicJson(pointerPath, createBranchPointer(branch, pointer.runId, identity), pointerOwner);
  }
  return run;
}
import { existsSync } from 'node:fs';

import { reduceWorkRun } from './work-run-contract.mjs';
import { atomicJson, readJson } from './work-run-json-store.mjs';
