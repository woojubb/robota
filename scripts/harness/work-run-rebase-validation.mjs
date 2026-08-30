import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

import { tryGit, tryGitBytes } from './work-run-git-adapter.mjs';
import {
  createWorkRunVerificationRuntime,
  takeWorkRunVerificationCommand,
} from './work-run-verification-runtime.mjs';

function generationRebaseProof(receipt) {
  return receipt.events.find(
    (event) =>
      event.type === 'work.reopened' &&
      event.data?.generation === receipt.generation &&
      event.data?.revision === 0,
  )?.data?.rebaseProof;
}

function commitExists(root, oid, runtime) {
  return tryGit(root, ['cat-file', '-e', `${oid}^{commit}`], runtime) !== null;
}

export function ensureRebaseCommitAvailable(root, oid, runtime) {
  if (commitExists(root, oid, runtime)) return true;
  const timeout = takeWorkRunVerificationCommand(runtime);
  const result = spawnSync('git', ['fetch', '--no-tags', 'origin', oid], {
    cwd: root,
    encoding: 'utf8',
    timeout,
    maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return !result.error && result.status === 0 && commitExists(root, oid, runtime);
}

function patchDigest(root, base, head, runtime) {
  const patch = tryGitBytes(root, ['diff', '--binary', `${base}..${head}`], runtime);
  return patch === null ? null : createHash('sha256').update(patch).digest('hex');
}

export function standaloneRebaseProofMatches(
  root,
  proof,
  runtime = createWorkRunVerificationRuntime(),
) {
  if (
    !proof ||
    ![proof.oldBase, proof.oldHead, proof.newBase, proof.newHead].every((oid) =>
      /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u.test(oid ?? ''),
    ) ||
    !/^[0-9a-f]{64}$/u.test(proof.patchDigest ?? '')
  ) {
    return false;
  }
  if (
    ![proof.oldBase, proof.oldHead, proof.newBase, proof.newHead].every((oid) =>
      ensureRebaseCommitAvailable(root, oid, runtime),
    )
  ) {
    return false;
  }
  if (tryGit(root, ['merge-base', proof.oldHead, proof.newBase], runtime) !== proof.oldBase)
    return false;
  return (
    patchDigest(root, proof.oldBase, proof.oldHead, runtime) === proof.patchDigest &&
    patchDigest(root, proof.newBase, proof.newHead, runtime) === proof.patchDigest
  );
}

export function rebaseProofMatches(root, receipt, boundaryHead, baseCommit, runtime) {
  const proof = generationRebaseProof(receipt);
  if (
    !proof ||
    proof.oldHead !== receipt.authorization.head ||
    proof.newBase !== baseCommit ||
    proof.newHead !== boundaryHead
  ) {
    return false;
  }
  return standaloneRebaseProofMatches(root, proof, runtime);
}
