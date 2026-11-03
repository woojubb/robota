import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, resolve, win32 } from 'node:path';

import {
  createStableRootedFileReader,
  StableFileAuthorityError,
} from '@robota-sdk/agent-file-authority';

import { SessionLogPayloadResolutionError } from './external-payload-resolution-contracts.js';
import { StoredLines, StoredPayloads, splitStoredLines } from './stored-append-lines.js';
import { sessionSealingOf } from './stored-session-record.js';

import type {
  IExternalPayloadSource,
  ISessionLogSource,
} from './external-payload-source-types.js';
import type { TStoredLine } from './stored-append-lines.js';
import type { ISessionStoreOptions } from './stored-session-record.js';

export type {
  IExternalPayloadSource,
  ISessionLogSource,
} from './external-payload-source-types.js';

function payloadPathSegments(relativePath: string): readonly string[] {
  if (
    relativePath.trim().length === 0 ||
    relativePath.includes('\0') ||
    isAbsolute(relativePath) ||
    win32.isAbsolute(relativePath)
  ) {
    throw outsideRootError(relativePath);
  }
  const segments = relativePath.split(/[\\/]+/u);
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw outsideRootError(relativePath);
  }
  return segments;
}

function validateMaxBytes(maxBytes: number): void {
  if (!Number.isFinite(maxBytes) || !Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new SessionLogPayloadResolutionError(
      'INVALID_LIMIT',
      'External-payload maxBytes must be a finite, non-negative safe integer.',
      { actual: String(maxBytes) },
    );
  }
}

function outsideRootError(relativePath: string, cause?: Error): SessionLogPayloadResolutionError {
  return new SessionLogPayloadResolutionError(
    'OUTSIDE_ROOT',
    `External payload path escapes its base directory or contains a link: ${relativePath}.`,
    { relativePath },
    cause,
  );
}

function mapStableFileAuthorityError(
  error: StableFileAuthorityError,
  relativePath: string,
  maxBytes: number,
): SessionLogPayloadResolutionError {
  if (error.code === 'INVALID_PATH' || error.code === 'UNSAFE_ENTRY') {
    return outsideRootError(relativePath, error);
  }
  if (error.code === 'UNSUPPORTED_BACKEND') {
    return new SessionLogPayloadResolutionError(
      'STABLE_PAYLOAD_READ_UNAVAILABLE',
      'Stable root-relative external-payload reads are unavailable on this host.',
      { relativePath },
      error,
    );
  }
  if (error.code === 'OVER_BUDGET') {
    return new SessionLogPayloadResolutionError(
      'MAX_TOTAL_BYTES_EXCEEDED',
      `External payload exceeds the remaining byte budget of ${maxBytes}.`,
      { relativePath, expected: maxBytes },
      error,
    );
  }
  return new SessionLogPayloadResolutionError(
    'PAYLOAD_UNREADABLE',
    `External payload could not be read: ${relativePath}.`,
    { relativePath },
    error,
  );
}

export interface INodeExternalPayloadSourceOptions extends ISessionStoreOptions {
  /**
   * The session the payloads belong to, which a sealed one is bound to. Left out, it is the session
   * whose `<id>.payloads` directory the reference names, the layout every sink writes.
   */
  readonly ownerId?: string;
}

const PAYLOAD_DIRECTORY_SUFFIX = '.payloads';

/** The session whose `<id>.payloads` directory holds a payload, or `undefined` for any other layout. */
function payloadDirectoryOwner(segments: readonly string[]): string | undefined {
  const directory = segments.length === 2 ? segments[0] : undefined;
  if (directory === undefined || !directory.endsWith(PAYLOAD_DIRECTORY_SUFFIX)) return undefined;
  return directory.slice(0, -PAYLOAD_DIRECTORY_SUFFIX.length) || undefined;
}

/** Explicit host-filesystem adapter. A file path is never accepted by the neutral parser itself. */
export class NodeExternalPayloadSource implements IExternalPayloadSource {
  private readonly baseDirectory: string;
  private readonly payloads: StoredPayloads;
  private readonly ownerId: string | undefined;

  /**
   * @param options `sealing` (required): `{ sealer }` opens sealed payloads (plain ones still
   *   resolve); `'plain'` meets a sealed payload as one no key in this process opens.
   */
  constructor(baseDirectory: string, options: INodeExternalPayloadSourceOptions) {
    if (baseDirectory.trim().length === 0) {
      throw new Error('External-payload base directory must not be empty.');
    }
    this.baseDirectory = resolve(baseDirectory);
    this.payloads = new StoredPayloads(sessionSealingOf(options));
    this.ownerId = options.ownerId;
  }

  readBytes(relativePath: string, maxBytes: number): Uint8Array | undefined {
    validateMaxBytes(maxBytes);
    const segments = payloadPathSegments(relativePath);
    const stored = this.readStored(relativePath, segments, maxBytes);
    if (stored === undefined) return undefined;
    return this.payloads.open(
      stored,
      maxBytes,
      this.ownerId ?? payloadDirectoryOwner(segments),
      relativePath,
    );
  }

  /** The bytes at the path, within the raw budget a sealed payload of `maxBytes` needs. */
  private readStored(
    relativePath: string,
    segments: readonly string[],
    maxBytes: number,
  ): Uint8Array | undefined {
    try {
      const reader = createStableRootedFileReader(this.baseDirectory);
      try {
        return reader.readBytes(segments, this.payloads.rawBudget(maxBytes));
      } finally {
        reader.close();
      }
    } catch (error) {
      if (error instanceof SessionLogPayloadResolutionError) throw error;
      if (error instanceof StableFileAuthorityError) {
        throw mapStableFileAuthorityError(error, relativePath, maxBytes);
      }
      throw new SessionLogPayloadResolutionError(
        'PAYLOAD_UNREADABLE',
        `External payload could not be read: ${relativePath}.`,
        { relativePath },
        error,
      );
    }
  }
}

/**
 * Explicit host-filesystem adapter for a JSONL session log. The log's owner — the session id its
 * sealed lines and payloads are bound to — is the file's stem, `<id>.jsonl`, the name every sink
 * writes; a sealed log copied under another session's name does not open as that session's.
 */
export class NodeSessionLogSource implements ISessionLogSource {
  readonly externalPayloadSource: IExternalPayloadSource;
  private readonly lines: StoredLines;
  private readonly ownerId: string;

  /**
   * @param options `sealing` (required): `{ sealer }` opens sealed lines and payloads (plain ones
   *   still read); `'plain'` meets a sealed line as one no key in this process opens.
   */
  constructor(
    private readonly logFile: string,
    options: ISessionStoreOptions,
  ) {
    if (logFile.trim().length === 0) {
      throw new Error('Session log-file path must not be empty.');
    }
    const sealing = sessionSealingOf(options);
    this.lines = new StoredLines(sealing, 'session-log-line');
    this.ownerId = basename(logFile, extname(logFile));
    this.externalPayloadSource = new NodeExternalPayloadSource(dirname(logFile), {
      sealing,
      ownerId: this.ownerId,
    });
  }

  /** Strict: the plain-equivalent text, failing on the first line it cannot read (see {@link StoredLines.openText}). */
  readText(): string | undefined {
    if (!existsSync(this.logFile)) return undefined;
    return this.lines.openText(readFileSync(this.logFile, 'utf8'), this.ownerId);
  }

  /** Tolerant: every physical line in file order, each as this process can read it; `undefined` when there is no log. */
  readStoredLines(): readonly TStoredLine[] | undefined {
    if (!existsSync(this.logFile)) return undefined;
    return splitStoredLines(readFileSync(this.logFile, 'utf8')).map((line) =>
      this.lines.decode(line, this.ownerId),
    );
  }
}
