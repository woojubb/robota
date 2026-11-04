/**
 * Why a store refused to replace the file at a session's path: each reason is something the store
 * saw, not a guess about who wrote what. Fixed text and the session id only.
 */

/** Why a save was refused. */
export type TSealedSessionRefusal =
  /** A sealed file it cannot open while the keys are locked, and has no proof it wrote or holds. */
  | 'locked'
  /** A sealed file that does not open here: damaged, or sealed with other keys that may still open it. */
  | 'does-not-open'
  /** A sealed file it cannot open, and different from the bytes it last wrote or held. */
  | 'changed'
  /** A file it could not read, or one too large for it to read back. */
  | 'unreadable'
  /** A file sealed in a framing version this build does not open, so written by a newer one. */
  | 'newer-format'
  /** A sealed file, and this store seals nothing, so this process has no keys for it at all. */
  | 'no-keys';

function refusalMessage(sessionId: string, reason: TSealedSessionRefusal): string {
  switch (reason) {
    case 'locked':
      return `Session ${sessionId} is sealed and locked, so it was not overwritten; unlock to open it.`;
    case 'does-not-open':
      return `Session ${sessionId} holds a sealed record that does not open for this session, so it was not overwritten.`;
    case 'changed':
      return `Session ${sessionId} changed on disk since this process last wrote or read it, so it was not overwritten.`;
    case 'unreadable':
      return `Session ${sessionId} could not be read, so it was not overwritten.`;
    case 'newer-format':
      return `Session ${sessionId} was sealed by a newer build, so it was not overwritten.`;
    case 'no-keys':
      return `Session ${sessionId} is sealed and this process has no keys that open it, so it was not overwritten.`;
  }
}

/**
 * Thrown by a store's `save` when the file already at that id may be a session nobody here can
 * read: sealed and not openable by this store, not provably what this store wrote or holds, not
 * readable at all, or sealed by a newer build. Overwriting would destroy what may be the only copy
 * of a session — `locked` is intact and a later unlock reads it, and a sealed file that does not open
 * here may open under other keys — so the save is refused and the file is left exactly as it was.
 */
export class SealedSessionUnreadableError extends Error {
  readonly code = 'SESSION_SEALED_UNREADABLE' as const;
  readonly sessionId: string;
  readonly reason: TSealedSessionRefusal;

  constructor(sessionId: string, reason: TSealedSessionRefusal) {
    super(refusalMessage(sessionId, reason));
    this.name = 'SealedSessionUnreadableError';
    this.sessionId = sessionId;
    this.reason = reason;
  }
}

/**
 * Whether `error` is a {@link SealedSessionUnreadableError}, by `code`: this package ships an ES and
 * a CommonJS build, and a process that loads both has two classes an `instanceof` cannot match across.
 */
export function isSealedSessionUnreadableError(
  error: unknown,
): error is SealedSessionUnreadableError {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { readonly code?: unknown }).code === 'SESSION_SEALED_UNREADABLE'
  );
}
