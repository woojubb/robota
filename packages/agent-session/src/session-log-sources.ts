import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
} from 'node:fs';
import { dirname, isAbsolute, join, resolve, win32 } from 'node:path';

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

function descriptorPath(descriptor: number, segment?: string): string {
  const root = `/proc/self/fd/${descriptor}`;
  return segment === undefined ? root : `${root}/${segment}`;
}

function openFlags(directory: boolean): number {
  return (
    constants.O_RDONLY |
    (constants.O_NOFOLLOW ?? 0) |
    (constants.O_NONBLOCK ?? 0) |
    (directory ? (constants.O_DIRECTORY ?? 0) : 0)
  );
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

function openRelativePayload(
  rootDescriptor: number,
  segments: readonly string[],
  relativePath: string,
): number | undefined {
  let parentDescriptor = rootDescriptor;
  let ownsParent = false;
  try {
    for (let index = 0; index < segments.length; index += 1) {
      const final = index === segments.length - 1;
      let descriptor: number;
      try {
        descriptor = openSync(descriptorPath(parentDescriptor, segments[index]), openFlags(!final));
      } catch (error) {
        const code =
          typeof error === 'object' && error !== null ? getNodeErrorCode(error) : undefined;
        if (code === 'ENOENT') return undefined;
        if (code === 'ELOOP' || code === 'ENOTDIR') {
          throw outsideRootError(relativePath);
        }
        throw error;
      }
      if (ownsParent) closeSync(parentDescriptor);
      parentDescriptor = descriptor;
      ownsParent = true;
    }
    const result = parentDescriptor;
    ownsParent = false;
    return result;
  } finally {
    if (ownsParent) closeSync(parentDescriptor);
  }
}

function readBoundedPayload(
  descriptor: number,
  relativePath: string,
  resolvedPath: string,
  maxBytes: number,
): Uint8Array {
  const metadata = fstatSync(descriptor, { bigint: true });
  if (!metadata.isFile()) {
    throw new SessionLogPayloadResolutionError(
      'PAYLOAD_UNREADABLE',
      `External payload is not a regular file: ${relativePath}.`,
      { relativePath, resolvedPath },
    );
  }
  if (metadata.size > BigInt(maxBytes)) {
    throw new SessionLogPayloadResolutionError(
      'MAX_TOTAL_BYTES_EXCEEDED',
      `External payload exceeds the remaining byte budget of ${maxBytes}.`,
      {
        relativePath,
        resolvedPath,
        expected: maxBytes,
        actual: metadata.size.toString(),
      },
    );
  }

  const expectedSize = Number(metadata.size);
  const bytes = Buffer.alloc(expectedSize);
  let offset = 0;
  while (offset < expectedSize) {
    const count = readSync(descriptor, bytes, offset, expectedSize - offset, offset);
    if (count === 0) break;
    offset += count;
  }
  const probe = Buffer.alloc(1);
  const grew = readSync(descriptor, probe, 0, 1, expectedSize) !== 0;
  const finalSize = fstatSync(descriptor, { bigint: true }).size;
  if (offset !== expectedSize || grew || finalSize !== metadata.size) {
    throw new SessionLogPayloadResolutionError(
      grew && expectedSize >= maxBytes ? 'MAX_TOTAL_BYTES_EXCEEDED' : 'PAYLOAD_UNREADABLE',
      `External payload changed while it was being read: ${relativePath}.`,
      { relativePath, resolvedPath, expected: expectedSize, actual: offset + (grew ? 1 : 0) },
    );
  }
  return bytes;
}

function getNodeErrorCode(error: object): string | undefined {
  if (!('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

function outsideRootError(relativePath: string): SessionLogPayloadResolutionError {
  return new SessionLogPayloadResolutionError(
    'OUTSIDE_ROOT',
    `External payload path escapes its base directory or contains a link: ${relativePath}.`,
    { relativePath },
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
    const resolvedPath = join(this.baseDirectory, ...segments);
    if (process.platform !== 'linux') {
      // Contained — ARCH-049. Supported-host stable handles must replace this refusal as one design.
      throw new SessionLogPayloadResolutionError(
        'PAYLOAD_UNREADABLE',
        'Stable no-follow external-payload reads are unavailable on this host.',
        { relativePath, resolvedPath },
      );
    }

    let rootDescriptor: number | undefined;
    let payloadDescriptor: number | undefined;
    try {
      const canonicalBaseDirectory = realpathSync(this.baseDirectory);
      rootDescriptor = openSync(canonicalBaseDirectory, openFlags(true));
      if (realpathSync(descriptorPath(rootDescriptor)) !== canonicalBaseDirectory) {
        throw new SessionLogPayloadResolutionError(
          'PAYLOAD_UNREADABLE',
          'The opened external-payload root no longer matches its canonical directory.',
          { relativePath, resolvedPath: canonicalBaseDirectory },
        );
      }
      payloadDescriptor = openRelativePayload(rootDescriptor, segments, relativePath);
      if (payloadDescriptor === undefined) return undefined;
      return readBoundedPayload(payloadDescriptor, relativePath, resolvedPath, maxBytes);
    } catch (error) {
      if (error instanceof SessionLogPayloadResolutionError) throw error;
      throw new SessionLogPayloadResolutionError(
        'PAYLOAD_UNREADABLE',
        `External payload could not be read: ${relativePath}.`,
        { relativePath, resolvedPath },
        error,
      );
    } finally {
      if (payloadDescriptor !== undefined) closeSync(payloadDescriptor);
      if (rootDescriptor !== undefined) closeSync(rootDescriptor);
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
