/**
 * How a host keeps its stored artifacts — session records, prompt-history lines, log lines and
 * payloads, checkpoint files, spilled tool results — readable only to whoever holds the keys, behind
 * the narrowest interface that can seal and open them.
 *
 * The contract lives here, in the foundation, so the packages that write those artifacts (the
 * session stores, the log sinks) take it as an injected port without depending on the host that
 * implements it. How the keys are held, and when they are locked, is the implementation's. A
 * caller sees only three outcomes of opening: the plaintext, "the keys are locked" and "this does
 * not open" — and never a key, a path or any part of the plaintext in an error.
 *
 * Sealing needs no unlocked key, so a process that never unlocked can still write; opening needs the
 * unlocked keys. The two failures are different on purpose: a locked artifact is intact and a later
 * unlock reads it, while a corrupt one is not going to open.
 *
 * What sealing proves is confidentiality and binding, not origin. Sealing needs only the public key,
 * so anyone who can read it can seal an artifact that opens; an artifact that opens says it is bound
 * to its kind and id and has not been altered since it was sealed, and nothing about who sealed it.
 * Origin is what an authorship tag adds: only unlocked keys make one, so a writer that wants a reader
 * to tell its own artifacts from anyone else's tags them while unlocked.
 */

/** What a sealed artifact is, which binds it to its own purpose as well as its owner. */
export type TArtifactKind =
  | 'session-record'
  | 'prompt-history-line'
  | 'session-log-line'
  | 'session-log-payload'
  | 'checkpoint-manifest'
  | 'checkpoint-preimage'
  | 'tool-result-spill';

/**
 * Whether the artifacts of a kind may share a data key. `writer-epoch` kinds are appended many at a
 * time by one writer and read back in bulk (a history search, a log replay), where one public-key
 * operation per artifact is too slow, so one sealer may reuse a data key for a context during a writer
 * epoch. `fresh` kinds are written whole and read one at a time, so each gets its own key, and nothing
 * on disk links one of them to another. Exhaustive, so a new kind does not compile until classified.
 */
export const ARTIFACT_KEY_REUSE: Readonly<Record<TArtifactKind, 'writer-epoch' | 'fresh'>> =
  Object.freeze({
    'session-record': 'fresh',
    'prompt-history-line': 'writer-epoch',
    'session-log-line': 'writer-epoch',
    'session-log-payload': 'writer-epoch',
    'checkpoint-manifest': 'fresh',
    'checkpoint-preimage': 'fresh',
    'tool-result-spill': 'fresh',
  });

/**
 * Which artifact is being sealed or opened. The implementation binds the sealed content to the
 * pair, so a sealed artifact copied to another owner's path, or read as another kind, does not open
 * for it instead of returning someone else's data.
 */
export interface IArtifactContext {
  readonly kind: TArtifactKind;
  /** The owning session id, or another owner's id; never contains `|`. */
  readonly id: string;
}

export interface IArtifactSealer {
  /**
   * Seals `plain` to a framed byte string: a four-byte magic, then the sealed blob. Never needs
   * unlocked keys. Seals for one context from one sealer may share a data key for a writer epoch when
   * {@link ARTIFACT_KEY_REUSE} says so for the kind; every sealed artifact still opens on its own, in
   * any order.
   */
  sealBytes(plain: Uint8Array, context: IArtifactContext): Uint8Array;
  /**
   * Opens bytes produced by {@link sealBytes}. Throws `ArtifactLockedError` when the keys are locked
   * and `ArtifactCorruptError` when the bytes are not sealed in a framing this build opens, are
   * damaged, or are not bound to `context`. The caller owns the returned buffer and may wipe it.
   */
  openBytes(stored: Uint8Array, context: IArtifactContext): Uint8Array;
  /** Whether `stored` carries a sealed-bytes magic of any version. A check of the framing only; it proves nothing about the content. */
  isSealedBytes(stored: Uint8Array): boolean;
  /**
   * Seals `plain` (any text, newlines included) to one text line with no newline in it, for
   * line-oriented files. Never needs unlocked keys. Shares data keys as {@link sealBytes} does; a line
   * opens without any other line of its file.
   */
  sealLine(plain: string, context: IArtifactContext): string;
  /** Opens a line produced by {@link sealLine}; fails the same two ways as {@link openBytes}. */
  openLine(stored: string, context: IArtifactContext): string;
  /** Whether `stored` carries a sealed-line prefix of any version. A check of the framing only. */
  isSealedLine(stored: string): boolean;
  /**
   * A token another process turns into a sealer that seals exactly as this one does and opens
   * nothing: non-secret (it carries only what sealing needs), serialisable, and opaque to everyone
   * but the implementation that issued it. A sealer offers one only when handing its sealing over
   * reveals no secret and its key outlives this process; otherwise it offers none, and a host that
   * needs one then refuses to start the writer elsewhere.
   */
  writeGrant?(): string;
  /**
   * A tag over `bytes` that only the unlocked keys make, bound to `context`, so a reader holding the
   * keys can tell that the owner's unlocked process wrote them: an artifact that opens says nothing
   * about who sealed it. Throws `ArtifactLockedError` while the keys are locked. Optional: a sealer
   * that holds no secret (a write grant's, a process-local one) offers none, and a writer then cannot
   * tag.
   */
  tagAuthorship?(bytes: Uint8Array, context: IArtifactContext): Uint8Array;
  /**
   * Whether `tag` is {@link tagAuthorship} of exactly `bytes` for exactly `context`, compared in
   * constant time. Throws `ArtifactLockedError` while the keys are locked; a sealer that offers no
   * tags offers no check either, and what it reads is unverified.
   */
  verifyAuthorship?(bytes: Uint8Array, tag: Uint8Array, context: IArtifactContext): boolean;
  /**
   * Calls `listener` after each unlock of the keys this sealer opens with, so a writer can tag what
   * it wrote while they were locked. An implementation may hold the listener weakly, so subscribing
   * never keeps the subscriber alive: the subscriber keeps its own reference for as long as it wants
   * to hear unlocks. Returns the unsubscribe. Optional, offered with {@link tagAuthorship}.
   */
  onUnlock?(listener: () => void): () => void;
}

/**
 * How a host keeps what it stores: sealed by `sealer`, or `'plain'`. Every store, log and file that
 * keeps conversation content states it, because one left plain beside sealed ones by omission would
 * write plaintext next to them.
 */
export type TArtifactSealing = { readonly sealer: IArtifactSealer } | 'plain';
