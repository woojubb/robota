/**
 * Why a sealed artifact did not open. A caller decides on `code` (or the predicates below), never
 * on the message, and neither error ever carries plaintext, a key, a path or the artifact's bytes —
 * the message is fixed text and the cause of the underlying failure is deliberately not chained.
 */

export type TArtifactSealerErrorCode = 'ARTIFACT_LOCKED' | 'ARTIFACT_CORRUPT';

/**
 * Why an intact artifact did not open. `locked`: the keys are locked, and unlocking and trying again
 * reads it. `no-keys`: this process holds no keys at all (a write-only sealer), so no unlock here will
 * read it; the owner's process does.
 */
export type TArtifactLockedReason = 'locked' | 'no-keys';

const LOCKED_MESSAGES: Readonly<Record<TArtifactLockedReason, string>> = {
  locked: 'The artifact is sealed and the keys are locked.',
  'no-keys': 'The artifact is sealed and this process holds no keys to open it.',
};

/** The artifact is intact but this process cannot open it now; `reason` says whether an unlock would help. */
export class ArtifactLockedError extends Error {
  readonly code = 'ARTIFACT_LOCKED' as const;
  readonly reason: TArtifactLockedReason;

  constructor(reason: TArtifactLockedReason = 'locked') {
    // Only the two known reasons reach the message, so it stays fixed text whatever a caller passes.
    const known = reason === 'no-keys' ? 'no-keys' : 'locked';
    super(LOCKED_MESSAGES[known]);
    this.name = 'ArtifactLockedError';
    this.reason = known;
  }
}

/**
 * The bytes are not a sealed artifact this build opens, are damaged, or are bound to a different
 * owner or kind. It says the artifact does not open here, and nothing about who wrote it.
 */
export class ArtifactCorruptError extends Error {
  readonly code = 'ARTIFACT_CORRUPT' as const;

  constructor() {
    super('The sealed artifact does not open: it is damaged, or not bound to this owner and kind.');
    this.name = 'ArtifactCorruptError';
  }
}

function hasCode(error: unknown, code: TArtifactSealerErrorCode): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { readonly code?: unknown }).code === code
  );
}

/**
 * Whether `error` is an {@link ArtifactLockedError}. Decided by `code`, not `instanceof`, so a copy
 * of the class from a second bundle of this package is still recognised.
 */
export function isArtifactLockedError(error: unknown): boolean {
  return hasCode(error, 'ARTIFACT_LOCKED');
}

/** Whether `error` is an {@link ArtifactCorruptError}; decided by `code` for the same reason. */
export function isArtifactCorruptError(error: unknown): boolean {
  return hasCode(error, 'ARTIFACT_CORRUPT');
}
