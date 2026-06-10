const ZERO_OBJECT_ID_PATTERN = /^0{40,64}$/u;

export function parsePrePushUpdates(input) {
  return input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [localRef, localObjectId, remoteRef, remoteObjectId] = line.split(/\s+/);
      return {
        localRef: localRef ?? '',
        localObjectId: localObjectId ?? '',
        remoteRef: remoteRef ?? '',
        remoteObjectId: remoteObjectId ?? '',
      };
    })
    .filter(
      (update) =>
        update.localRef && update.localObjectId && update.remoteRef && update.remoteObjectId,
    );
}

export function isDeletedRefUpdate(update) {
  return update.localRef === '(delete)' || ZERO_OBJECT_ID_PATTERN.test(update.localObjectId);
}

export function decidePrePushVerification({ updates, baseRef, treeMatchesBase }) {
  if (updates.length > 0 && updates.every(isDeletedRefUpdate)) {
    return {
      shouldRun: false,
      reason: 'delete-only push',
    };
  }

  if (baseRef && treeMatchesBase) {
    return {
      shouldRun: false,
      reason: `no content delta from ${baseRef}`,
    };
  }

  return {
    shouldRun: true,
    reason: null,
  };
}

/** Failure message for the pre-push lockfile consistency gate (HARNESS-012). */
export function formatLockfileFailureMessage() {
  return (
    '\n[BLOCKED] pnpm-lock.yaml is out of date with a package.json — push blocked.\n' +
    'CI would fail with ERR_PNPM_OUTDATED_LOCKFILE (incident: PR #688, HARNESS-012).\n' +
    'Fix:\n' +
    '  pnpm install\n' +
    '  git add pnpm-lock.yaml && git commit\n\n'
  );
}
