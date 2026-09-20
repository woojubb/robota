import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve, win32 } from 'node:path';

import {
  createStableRootedFileReader,
  StableFileAuthorityError,
} from '@robota-sdk/agent-file-authority';

import { SessionLogPayloadResolutionError } from './external-payload-resolution-contracts.js';

/** Workspace-neutral byte source for relative external-payload references. */
export interface IExternalPayloadSource {
  readBytes(relativePath: string, maxBytes: number): Uint8Array | undefined;
}

/** Workspace-neutral source for one session-log document and its optional payload source. */
export interface ISessionLogSource {
  readText(): string | undefined;
  readonly externalPayloadSource?: IExternalPayloadSource;
}

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

/** Explicit host-filesystem adapter. A file path is never accepted by the neutral parser itself. */
export class NodeExternalPayloadSource implements IExternalPayloadSource {
  private readonly baseDirectory: string;

  constructor(baseDirectory: string) {
    if (baseDirectory.trim().length === 0) {
      throw new Error('External-payload base directory must not be empty.');
    }
    this.baseDirectory = resolve(baseDirectory);
  }

  readBytes(relativePath: string, maxBytes: number): Uint8Array | undefined {
    validateMaxBytes(maxBytes);
    const segments = payloadPathSegments(relativePath);
    try {
      const reader = createStableRootedFileReader(this.baseDirectory);
      try {
        return reader.readBytes(segments, maxBytes);
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

/** Explicit host-filesystem adapter for a JSONL session log. */
export class NodeSessionLogSource implements ISessionLogSource {
  readonly externalPayloadSource: IExternalPayloadSource;

  constructor(private readonly logFile: string) {
    if (logFile.trim().length === 0) {
      throw new Error('Session log-file path must not be empty.');
    }
    this.externalPayloadSource = new NodeExternalPayloadSource(dirname(logFile));
  }

  readText(): string | undefined {
    return existsSync(this.logFile) ? readFileSync(this.logFile, 'utf8') : undefined;
  }
}
