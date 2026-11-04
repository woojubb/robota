/**
 * What a line in an append-only store means, and what a sidecar beside a session log holds.
 *
 * The prompt-history file, both session-log sinks and both session-log sources route every append
 * and every read through this one module — the pattern `StoredSessionRecords` set for records — so
 * none of them can disagree about a sealed line, a torn one, or one written by a newer build.
 *
 * A store that seals appends each call as ONE sealed line that opens on its own: no line waits for
 * another, so a reader walking a file backwards, or paging it, opens exactly the lines it shows.
 * Every sealed append starts with a newline as well as ending with one. Appends are not atomic
 * (Node loops on a short write), and a writer can die part-way; the leading newline puts whatever
 * fragment it left on a line of its own, so the next record is never glued to it. A reader skips
 * empty lines, and the final fragment of a file, if it carries sealed framing (or the start of it)
 * and no newline yet, is an append still in progress rather than a line.
 *
 * A store that seals nothing writes plain lines, and meets a sealed line as one no key in its
 * process opens. Plain and sealed lines may sit in one file, each read by its
 * own framing.
 *
 * An externalized payload of a sealing log is sealed under a RANDOM name. A content-addressed name
 * would let any program of the same user confirm a guessed payload, or see which payloads are equal;
 * the digest now lives only inside the sealed line, where the resolver still checks it against the
 * bytes it opens, so two sealed sidecars swapped with each other are caught. Dedupe is in-process.
 */
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';

import {
  ArtifactCorruptError,
  ArtifactLockedError,
  SEALED_ARTIFACT_MAX_OVERHEAD_BYTES,
  isArtifactCorruptError,
  isArtifactLockedError,
  isCurrentSealedArtifactBytes,
  isCurrentSealedArtifactLine,
  isSealedArtifactBytes,
  isSealedArtifactLine,
} from '@robota-sdk/agent-core';

import { SessionLogPayloadResolutionError } from './external-payload-resolution-contracts.js';
import { SessionLogDecodeError } from './session-log-codec/index.js';
import { createSessionLogExternalPayloadReference } from './session-log-sinks.js';
import { assertSessionSealing } from './stored-session-record.js';

import type { IExternalPayloadReference } from './session-log-reference-types.js';
import type {
  IArtifactContext,
  IArtifactSealer,
  TArtifactKind,
  TArtifactLockedReason,
  TArtifactSealing,
} from '@robota-sdk/agent-core';

/** The kinds of artifact an append store's lines are sealed as. */
export type TAppendLineKind = Extract<TArtifactKind, 'prompt-history-line' | 'session-log-line'>;

/** One physical line of an append store, as this process can read it. Never carries key material. */
export type TStoredLine =
  /** A plain line (one element, verbatim), or a sealed record opened to the lines it holds. */
  | { readonly kind: 'lines'; readonly lines: readonly string[] }
  /** Sealed and intact as far as anyone can tell; `reason` says whether an unlock here would read it. */
  | { readonly kind: 'locked'; readonly reason: TArtifactLockedReason }
  /** Sealed in this build's framing and it does not open for this owner: damaged, torn, or sealed with other keys. */
  | { readonly kind: 'does-not-open' }
  /** Sealed in a framing version a newer build writes: never opened, never counted as damage. */
  | { readonly kind: 'newer-format' };

const NEWLINE = '\n';
const DOES_NOT_OPEN: TStoredLine = Object.freeze({ kind: 'does-not-open' });
const NEWER_FORMAT: TStoredLine = Object.freeze({ kind: 'newer-format' });
const NO_KEYS: TStoredLine = Object.freeze({ kind: 'locked', reason: 'no-keys' });
/** The start of a sealed-line prefix, too short to carry its colon yet: `R`, `RS`, `RSL`, `RSL` and a version digit. */
const PARTIAL_SEALED_LINE_PREFIX = /^R(?:S(?:L[0-9]?)?)?$/;

function sealerOf(sealing: TArtifactSealing): IArtifactSealer | undefined {
  assertSessionSealing(sealing);
  return sealing === 'plain' ? undefined : sealing.sealer;
}

function lockedReasonOf(error: unknown): TArtifactLockedReason {
  return (error as { readonly reason?: unknown }).reason === 'no-keys' ? 'no-keys' : 'locked';
}

/** How one append store keeps its lines: sealed as `kind`, bound to the owner id each call names. */
export class StoredLines {
  readonly #sealer: IArtifactSealer | undefined;
  readonly #kind: TAppendLineKind;

  constructor(sealing: TArtifactSealing, kind: TAppendLineKind) {
    this.#sealer = sealerOf(sealing);
    this.#kind = kind;
  }

  /**
   * What to append for `text` — one or more `\n`-terminated lines, exactly what a plain store
   * appends in that call. Plain: `text` itself. Sealing: one sealed line with a newline before and
   * after it. Throws whatever sealing throws; it never falls back to plaintext.
   */
  encode(text: string, ownerId: string): string {
    if (this.#sealer === undefined) return text;
    return `${NEWLINE}${this.#sealer.sealLine(text, { kind: this.#kind, id: ownerId })}${NEWLINE}`;
  }

  /** One physical line (no `\n` in it), as this process can read it. Never throws. */
  decode(line: string, ownerId: string): TStoredLine {
    try {
      return this.#decode(line, ownerId);
    } catch {
      // A failure of the sealer that says neither "locked" nor "does not open" is no evidence the
      // line is fine, and must not take a tolerant reader down: it is a line that does not open.
      return DOES_NOT_OPEN;
    }
  }

  /**
   * Strict: the plain-equivalent text of a whole store's `text`, for decoders that fail on any bad
   * line (see {@link openedText}). A failure of the sealer that is neither `ArtifactLockedError` nor
   * `ArtifactCorruptError` is a defect (a refused context, a misused key), not a damaged line, so it
   * is thrown as it was rather than reported as corruption.
   */
  openText(text: string, ownerId: string): string {
    const lines = splitStoredLines(text);
    const decode = (line: string): TStoredLine => this.#decode(line, ownerId);
    return openedText(
      (function* decodeInOrder() {
        for (const line of lines) yield decode(line);
      })(),
    );
  }

  /** One physical line; throws only what the sealer threw that is neither locked nor corrupt. */
  #decode(line: string, ownerId: string): TStoredLine {
    if (!isSealedArtifactLine(line)) return { kind: 'lines', lines: [line] };
    if (!isCurrentSealedArtifactLine(line)) return NEWER_FORMAT;
    // A sealed line and no sealer: no unlock in this process would open it.
    if (this.#sealer === undefined) return NO_KEYS;
    let text: string;
    try {
      text = this.#sealer.openLine(line, { kind: this.#kind, id: ownerId });
    } catch (error) {
      if (isArtifactLockedError(error)) return { kind: 'locked', reason: lockedReasonOf(error) };
      if (isArtifactCorruptError(error)) return DOES_NOT_OPEN;
      throw error;
    }
    return { kind: 'lines', lines: text.split(NEWLINE).filter((opened) => opened.length > 0) };
  }
}

/**
 * The physical lines of a store's text. An UNTERMINATED final fragment with sealed framing, or so
 * short that it is still only the start of it (`RSL` and a version digit, cut anywhere), is left
 * out: every sealed append ends with a newline, so such a fragment is an append in progress (or one
 * whose writer died), not a record. A plain fragment is kept as it is.
 */
export function splitStoredLines(text: string): string[] {
  const lines = text.split(NEWLINE);
  const tail = lines[lines.length - 1] as string;
  if (tail.length > 0 && (isSealedArtifactLine(tail) || PARTIAL_SEALED_LINE_PREFIX.test(tail))) {
    lines.pop();
  }
  return lines;
}

/**
 * The plain-equivalent text of a whole store, for decoders that fail on any bad line: what a plain
 * store would hold, so a file of plain lines comes back byte for byte. The first line that cannot be
 * read decides the failure — `ArtifactLockedError` (with its reason) for a locked one,
 * `ArtifactCorruptError` for one that does not open, `SessionLogDecodeError` (`UNSUPPORTED_VERSION`)
 * for one a newer build sealed.
 */
export function openedText(stored: Iterable<TStoredLine>): string {
  const parts: string[] = [];
  let lineNumber = 0;
  for (const line of stored) {
    lineNumber += 1;
    switch (line.kind) {
      case 'lines':
        parts.push(line.lines.join(NEWLINE));
        break;
      case 'locked':
        throw new ArtifactLockedError(line.reason);
      case 'does-not-open':
        throw new ArtifactCorruptError();
      case 'newer-format':
        throw new SessionLogDecodeError('UNSUPPORTED_VERSION', [
          {
            path: `line ${lineNumber}`,
            message: 'the line is sealed in a framing version this build does not open',
          },
        ]);
    }
  }
  return parts.join(NEWLINE);
}

/** 16 random bytes: a name no one can derive from the payload or guess. */
const SEALED_PAYLOAD_NAME_BYTES = 16;
const SEALED_PAYLOAD_EXTENSION = '.sealed';

/** One sidecar a sink is asked to write. */
export interface IStoredPayloadWrite {
  readonly relativePath: string;
  readonly data: string | Uint8Array;
  /**
   * The name is the content's own digest, so a file already at it holds these exact bytes and need
   * not be written again. A sealed sidecar's name is random: a file already there is not this one.
   */
  readonly contentAddressed: boolean;
}

function payloadError(
  code: 'PAYLOAD_UNREADABLE' | 'MAX_TOTAL_BYTES_EXCEEDED',
  relativePath: string,
  maxBytes: number,
): SessionLogPayloadResolutionError {
  return code === 'PAYLOAD_UNREADABLE'
    ? new SessionLogPayloadResolutionError(
        code,
        `External payload is sealed and does not open here: ${relativePath}.`,
        { relativePath },
      )
    : new SessionLogPayloadResolutionError(
        code,
        `External payload exceeds the remaining byte budget of ${maxBytes}.`,
        { relativePath, expected: maxBytes },
      );
}

/**
 * How a session-log sink places externalized JSON values beside its log, and how a source opens what
 * it reads back. Plain: the content-addressed `<id>.payloads/<sha256>.json`. Sealing:
 * `<id>.payloads/<22 random base64url characters>.sealed`, holding the payload sealed as
 * `session-log-payload` for the session, written once per payload per instance.
 */
export class StoredPayloads {
  readonly #sealer: IArtifactSealer | undefined;
  /** Per session: plaintext digest → the sealed sidecar this instance already wrote for it. */
  readonly #written = new Map<string, Map<string, string>>();

  constructor(sealing: TArtifactSealing) {
    this.#sealer = sealerOf(sealing);
  }

  /**
   * The reference a log line carries for `serialized`, after `write` has put its sidecar in place.
   * `write` is called at most once; a sealed name is remembered only once `write` returned, so a
   * failed write is attempted again for the next reference to the same payload.
   */
  place(
    sessionId: string,
    sha256: string,
    serialized: string,
    write: (target: IStoredPayloadWrite) => void,
  ): IExternalPayloadReference {
    const reference = createSessionLogExternalPayloadReference(sessionId, sha256, serialized);
    if (this.#sealer === undefined) {
      write({ relativePath: reference.relativePath, data: serialized, contentAddressed: true });
      return reference;
    }
    const written = this.#written.get(sessionId) ?? new Map<string, string>();
    const known = written.get(sha256);
    if (known !== undefined) return { ...reference, relativePath: known };
    const name = randomBytes(SEALED_PAYLOAD_NAME_BYTES).toString('base64url');
    const relativePath = join(`${sessionId}.payloads`, `${name}${SEALED_PAYLOAD_EXTENSION}`);
    const plain = Buffer.from(serialized, 'utf8');
    let data: Uint8Array;
    try {
      data = this.#sealer.sealBytes(plain, { kind: 'session-log-payload', id: sessionId });
    } finally {
      plain.fill(0);
    }
    write({ relativePath, data, contentAddressed: false });
    written.set(sha256, relativePath);
    this.#written.set(sessionId, written);
    return { ...reference, relativePath };
  }

  /** How many bytes to read for a payload whose plaintext budget is `maxBytes`. */
  rawBudget(maxBytes: number): number {
    if (this.#sealer === undefined) return maxBytes;
    return Math.min(maxBytes + SEALED_ARTIFACT_MAX_OVERHEAD_BYTES, Number.MAX_SAFE_INTEGER);
  }

  /**
   * The payload bytes in `stored` (what was read at `relativePath`), held to the plaintext budget
   * exactly. A plain store reads every payload as bytes: only a sealed line can
   * reference a sealed payload, and a plain reader never gets past the line. A sealing store passes
   * plain bytes through too, so a directory written before sealing still resolves — a JSON payload
   * never starts with the sealed magic — and opens sealed bytes bound to `ownerId`:
   * `ArtifactLockedError` while they cannot be opened here, and `PAYLOAD_UNREADABLE` when they do
   * not open, were sealed by a newer build, or have no owner to open them for. Any other failure of
   * the sealer is a defect, thrown as it was. The caller then checks the result against the
   * reference's digest and length.
   */
  open(
    stored: Uint8Array,
    maxBytes: number,
    ownerId: string | undefined,
    relativePath: string,
  ): Uint8Array {
    if (this.#sealer === undefined) return stored;
    if (!isSealedArtifactBytes(stored)) {
      if (stored.byteLength > maxBytes) {
        throw payloadError('MAX_TOTAL_BYTES_EXCEEDED', relativePath, maxBytes);
      }
      return stored;
    }
    if (!isCurrentSealedArtifactBytes(stored)) {
      throw payloadError('PAYLOAD_UNREADABLE', relativePath, maxBytes);
    }
    if (ownerId === undefined) throw payloadError('PAYLOAD_UNREADABLE', relativePath, maxBytes);
    let plain: Uint8Array;
    try {
      plain = this.#sealer.openBytes(stored, { kind: 'session-log-payload', id: ownerId });
    } catch (error) {
      if (isArtifactLockedError(error)) throw new ArtifactLockedError(lockedReasonOf(error));
      if (isArtifactCorruptError(error)) {
        throw payloadError('PAYLOAD_UNREADABLE', relativePath, maxBytes);
      }
      throw error;
    }
    if (plain.byteLength > maxBytes) {
      plain.fill(0);
      throw payloadError('MAX_TOTAL_BYTES_EXCEEDED', relativePath, maxBytes);
    }
    return plain;
  }
}

/** What a stored sidecar is to a migration that seals what is still plain in place (#3679). */
export type TStoredPayloadMigrationState = 'plain' | 'sealed' | 'does-not-open' | 'newer-format';

function payloadContext(ownerId: string): IArtifactContext {
  return { kind: 'session-log-payload', id: ownerId };
}

/**
 * Where a sidecar of session `ownerId` stands: decided by whether it opens for that session, never by
 * framing alone. With the keys locked it throws `ArtifactLockedError`.
 */
export function storedPayloadMigrationState(
  stored: Uint8Array,
  ownerId: string,
  sealer: IArtifactSealer,
): TStoredPayloadMigrationState {
  if (!isSealedArtifactBytes(stored)) return 'plain';
  if (!isCurrentSealedArtifactBytes(stored)) return 'newer-format';
  let plain: Uint8Array;
  try {
    plain = sealer.openBytes(stored, payloadContext(ownerId));
  } catch (error) {
    if (isArtifactLockedError(error)) throw error;
    return 'does-not-open';
  }
  plain.fill(0);
  return 'sealed';
}

/**
 * A plain sidecar's bytes sealed for session `ownerId`, to be put back under the SAME name: a source
 * opens sealed bytes whatever the name ({@link StoredPayloads.open}), and the digest and length every
 * reference — nested ones included — checks are the plaintext's, so no reference changes.
 */
export function sealStoredPayloadBytes(
  plain: Uint8Array,
  ownerId: string,
  sealer: IArtifactSealer,
): Uint8Array {
  return sealer.sealBytes(plain, payloadContext(ownerId));
}

/** Where a rewrite of an append store puts the lines it produces. */
export interface IStoredLineSink {
  write(text: string): void;
}

/** One physical line of a session log as both transcript pages read it: a trailing `\r` is not content. */
function logLineContent(physical: string): string {
  return physical.endsWith('\r') ? physical.slice(0, -1) : physical;
}

/**
 * Seals the plain lines of a session log as a migration does: one sealed record per non-empty plain
 * line, a sealed line kept as it is, an empty line dropped — exactly the records both transcript
 * pages count, so a stored-record offset names the same line before and after.
 */
export class SessionLogLineSealer {
  sealedLines = 0;
  carriedLines = 0;
  readonly #lines: StoredLines;

  constructor(
    sealer: IArtifactSealer,
    private readonly ownerId: string,
  ) {
    this.#lines = new StoredLines({ sealer }, 'session-log-line');
  }

  /** `leadingNewline` frames each line `\n<line>\n`, for a file other writers append to meanwhile. */
  rewrite(lines: Iterable<string>, out: IStoredLineSink, leadingNewline: boolean): void {
    for (const physical of lines) {
      const line = logLineContent(physical);
      if (line.length === 0) continue;
      if (isSealedArtifactLine(line)) {
        out.write(`${leadingNewline ? NEWLINE : ''}${line}${NEWLINE}`);
        this.carriedLines += 1;
        continue;
      }
      const stored = this.#lines.encode(`${line}${NEWLINE}`, this.ownerId);
      out.write(leadingNewline ? stored : stored.slice(NEWLINE.length));
      this.sealedLines += 1;
    }
  }
}

/** The plain records a session log's text holds, as a migration would seal them. */
export function countPlainSessionLogLines(text: string): number {
  return splitStoredLines(text).filter((physical) => {
    const line = logLineContent(physical);
    return line.length > 0 && !isSealedArtifactLine(line);
  }).length;
}

/** A whole session log's text with every plain line sealed, for a store that replaces the file whole. */
export interface ISealedSessionLogText {
  readonly text: string;
  readonly sealedLines: number;
  readonly carriedLines: number;
}

/**
 * `text` (a whole log, nothing appending to it) with every plain record sealed for session
 * `ownerId` as {@link SessionLogLineSealer} seals it. An unfinished sealed append at the end, which
 * no reader shows, is dropped; an unfinished plain line is a record, and is sealed.
 */
export function sealSessionLogText(
  text: string,
  ownerId: string,
  sealer: IArtifactSealer,
): ISealedSessionLogText {
  const sealing = new SessionLogLineSealer(sealer, ownerId);
  const parts: string[] = [];
  sealing.rewrite(splitStoredLines(text), { write: (part) => parts.push(part) }, false);
  return {
    text: parts.join(''),
    sealedLines: sealing.sealedLines,
    carriedLines: sealing.carriedLines,
  };
}
