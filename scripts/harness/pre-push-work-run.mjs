import { validateWorkRunRange } from './scan-work-run-measurement.mjs';
import { isDeletedRefUpdate } from './pre-push-updates.mjs';
import { classifyFiles, classifyRange } from './classify-changed-paths.mjs';

const OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

export function isPrePushInputWellFormed(input) {
  const lines = input
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
  return (
    lines.length > 0 &&
    lines.every((line) => {
      const fields = line.split(/\s+/u);
      return (
        fields.length === 4 &&
        OBJECT_ID_PATTERN.test(fields[1]) &&
        OBJECT_ID_PATTERN.test(fields[3])
      );
    })
  );
}

export function isPrePushHookInvocation({ inputProvided, remoteName, remoteUrl }) {
  return inputProvided || remoteName !== null || remoteUrl !== null;
}

function resolveCheckoutSubject(currentBranch, headOid) {
  if (!currentBranch) return { ok: false, reason: 'HEAD is detached' };
  if (!OBJECT_ID_PATTERN.test(headOid)) return { ok: false, reason: 'HEAD OID is unavailable' };
  return {
    ok: true,
    branch: currentBranch,
    localRef: `refs/heads/${currentBranch}`,
    localObjectId: headOid,
    source: 'checkout',
  };
}

function resolveHookUpdateSubject(update, currentBranch, headOid) {
  if (!OBJECT_ID_PATTERN.test(update.localObjectId))
    return { ok: false, reason: 'pushed object ID is malformed' };
  if (!OBJECT_ID_PATTERN.test(update.remoteObjectId))
    return { ok: false, reason: 'remote object ID is malformed' };
  const expectedRef = `refs/heads/${currentBranch}`;
  if (!currentBranch || update.localRef !== expectedRef)
    return { ok: false, reason: 'pushed local ref is not the current branch' };
  if (update.remoteRef !== expectedRef)
    return { ok: false, reason: 'push renames the current branch ref' };
  if (update.localObjectId !== headOid)
    return { ok: false, reason: 'pushed object does not equal HEAD' };
  return {
    ok: true,
    branch: update.localRef.slice('refs/heads/'.length),
    localRef: update.localRef,
    localObjectId: update.localObjectId,
    source: 'push-update',
  };
}

export function resolvePrePushSubject({
  updates,
  hookInputProvided,
  hookInputWellFormed = true,
  currentBranch,
  headOid,
}) {
  if (!hookInputProvided) return resolveCheckoutSubject(currentBranch, headOid);

  if (!hookInputWellFormed) return { ok: false, reason: 'pre-push input is malformed' };
  if (updates.length > 0 && updates.every(isDeletedRefUpdate)) {
    return { ok: true, deleteOnly: true, source: 'push-update' };
  }
  if (updates.length !== 1) {
    return { ok: false, reason: 'push does not contain exactly one non-delete ref update' };
  }

  return resolveHookUpdateSubject(updates[0], currentBranch, headOid);
}

export function resolvePrePushHookContext({ prePushInput, updates, currentBranch, headOid, env }) {
  const hookInputProvided = isPrePushHookInvocation({
    inputProvided: prePushInput.provided,
    remoteName: env.HARNESS_PRE_PUSH_REMOTE_NAME ?? null,
    remoteUrl: env.HARNESS_PRE_PUSH_REMOTE_URL ?? null,
  });
  const pushSubject = resolvePrePushSubject({
    updates,
    hookInputProvided,
    hookInputWellFormed: !hookInputProvided || isPrePushInputWellFormed(prePushInput.input),
    currentBranch,
    headOid,
  });
  if (!pushSubject.ok)
    throw new Error(`pre-push subject could not be resolved: ${pushSubject.reason}`);
  return { pushSubject, hookInputProvided };
}

export function createPrePushChangeContext({ baseRef, pushSubject, headOid, root }) {
  const subjectRef = pushSubject.localObjectId ?? headOid;
  const changeClassification = baseRef
    ? classifyRange({ baseRef, head: subjectRef, cwd: root })
    : classifyFiles([]);
  return { subjectRef, changeClassification };
}

/** Keep the work-run gate before receipt reuse and every verification path. */
export function runPrePushGate(steps) {
  steps.pruneAndWarnStaleWorktrees();
  steps.assertCleanWorkingTree();
  steps.assertLockfileConsistency();
  steps.reportBaseResolution();

  const decision = steps.decideVerification();
  if (!decision.shouldRun) {
    steps.reportSkipped(decision.reason);
    return { verified: false, reason: decision.reason };
  }

  const measurement = steps.validateWorkRunMeasurement();
  if (!measurement.ok) {
    throw new Error(`work-run measurement refused the push: ${measurement.reason}`);
  }

  const receipt = steps.findReusableReceipt();
  if (receipt.reusable) {
    steps.reportReceiptReused(receipt);
    return { verified: true, reused: true, reason: 'exact verify-like-ci receipt' };
  }

  steps.assertTreePrerequisites();
  steps.runVerification();
  return { verified: true, reason: null };
}

export function createWorkRunMeasurementInput({ root, baseRef, pushSubject }) {
  if (pushSubject.localRef !== `refs/heads/${pushSubject.branch}`) {
    throw new Error('resolved local ref does not match the resolved branch');
  }
  return {
    root,
    baseRef,
    subjectRef: pushSubject.localObjectId,
    subjectBranch: pushSubject.branch,
    prObservation: 'pre-push',
  };
}

export function createWorkRunMeasurementStep(input, validate = validateWorkRunRange) {
  const measurementInput = createWorkRunMeasurementInput(input);
  return () => validate(measurementInput);
}
