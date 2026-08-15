import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep, win32 } from 'node:path';

import { SessionLogPayloadResolutionError } from './external-payload-resolution-contracts.js';

import type { IExternalPayloadReference } from './session-logger.js';

const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

export interface IExternalPayloadFileState {
  readonly baseDirectory: string;
  readonly maxTotalBytes: number;
  canonicalBaseDirectory?: string;
  totalBytes: number;
}

export function validateExternalPayloadReference(
  value: Record<string, unknown>,
): IExternalPayloadReference {
  if (!isValidSessionLogExternalPayloadReference(value)) {
    throw new SessionLogPayloadResolutionError(
      'INVALID_REFERENCE',
      'External payload reference has an invalid shape.',
    );
  }
  return {
    kind: 'external-payload',
    encoding: 'json',
    sha256: String(value.sha256).toLowerCase(),
    byteLength: Number(value.byteLength),
    relativePath: String(value.relativePath),
  };
}

/** Internal SSOT shared by the resolver and raw-log validator; not part of the package barrel. */
export function isValidSessionLogExternalPayloadReference(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value).sort();
  const expectedKeys = ['byteLength', 'encoding', 'kind', 'relativePath', 'sha256'];
  return (
    keys.length === expectedKeys.length &&
    keys.every((key, index) => key === expectedKeys[index]) &&
    value.kind === 'external-payload' &&
    value.encoding === 'json' &&
    typeof value.sha256 === 'string' &&
    SHA256_PATTERN.test(value.sha256) &&
    typeof value.byteLength === 'number' &&
    Number.isSafeInteger(value.byteLength) &&
    value.byteLength >= 0 &&
    typeof value.relativePath === 'string' &&
    value.relativePath.trim().length > 0
  );
}

export function resolveExternalPayloadPath(
  relativePath: string,
  state: IExternalPayloadFileState,
): string {
  if (relativePath.includes('\0') || isAbsolute(relativePath) || win32.isAbsolute(relativePath)) {
    throw outsideRootError(relativePath);
  }
  const segments = relativePath.split(/[\\/]+/u);
  if (segments.some((segment) => segment === '..' || segment === '.')) {
    throw outsideRootError(relativePath);
  }
  const lexicalPath = resolve(state.baseDirectory, segments.join(sep));
  if (!isWithin(state.baseDirectory, lexicalPath)) {
    throw outsideRootError(relativePath, lexicalPath);
  }
  const canonicalPayloadPath = getCanonicalPayloadPath(relativePath, lexicalPath);
  if (!isWithin(getCanonicalBaseDirectory(state), canonicalPayloadPath)) {
    throw outsideRootError(relativePath, canonicalPayloadPath);
  }
  return canonicalPayloadPath;
}

export function readExternalPayloadJson(
  reference: IExternalPayloadReference,
  payloadPath: string,
  state: IExternalPayloadFileState,
): unknown {
  const size = getPayloadFileSize(reference, payloadPath);
  chargePayloadBytes(reference, payloadPath, size, state);
  const bytes = readPayloadBytes(reference, payloadPath);
  verifyPayloadIntegrity(reference, payloadPath, bytes);
  try {
    return JSON.parse(bytes.toString('utf8')) as unknown;
  } catch (error) {
    throw new SessionLogPayloadResolutionError(
      'INVALID_JSON',
      `External payload is not valid JSON: ${reference.relativePath}.`,
      { relativePath: reference.relativePath, resolvedPath: payloadPath },
      error,
    );
  }
}

function getPayloadFileSize(reference: IExternalPayloadReference, payloadPath: string): number {
  try {
    const stat = statSync(payloadPath);
    if (!stat.isFile()) {
      throw new SessionLogPayloadResolutionError(
        'PAYLOAD_UNREADABLE',
        `External payload is not a regular file: ${reference.relativePath}.`,
        { relativePath: reference.relativePath, resolvedPath: payloadPath },
      );
    }
    return stat.size;
  } catch (error) {
    if (error instanceof SessionLogPayloadResolutionError) throw error;
    throw fileAccessError(error, reference.relativePath, payloadPath);
  }
}

function chargePayloadBytes(
  reference: IExternalPayloadReference,
  payloadPath: string,
  size: number,
  state: IExternalPayloadFileState,
): void {
  const nextTotalBytes = state.totalBytes + size;
  if (!Number.isSafeInteger(nextTotalBytes) || nextTotalBytes > state.maxTotalBytes) {
    throw new SessionLogPayloadResolutionError(
      'MAX_TOTAL_BYTES_EXCEEDED',
      `External-payload bytes exceed the configured maximum of ${state.maxTotalBytes}.`,
      {
        relativePath: reference.relativePath,
        resolvedPath: payloadPath,
        expected: state.maxTotalBytes,
        actual: nextTotalBytes,
      },
    );
  }
  state.totalBytes = nextTotalBytes;
}

function readPayloadBytes(reference: IExternalPayloadReference, payloadPath: string): Buffer {
  try {
    return readFileSync(payloadPath);
  } catch (error) {
    throw new SessionLogPayloadResolutionError(
      'PAYLOAD_UNREADABLE',
      `External payload could not be read: ${reference.relativePath}.`,
      { relativePath: reference.relativePath, resolvedPath: payloadPath },
      error,
    );
  }
}

function verifyPayloadIntegrity(
  reference: IExternalPayloadReference,
  payloadPath: string,
  bytes: Buffer,
): void {
  if (bytes.byteLength !== reference.byteLength) {
    throw new SessionLogPayloadResolutionError(
      'BYTE_LENGTH_MISMATCH',
      `External payload byte length does not match its reference: ${reference.relativePath}.`,
      {
        relativePath: reference.relativePath,
        resolvedPath: payloadPath,
        expected: reference.byteLength,
        actual: bytes.byteLength,
      },
    );
  }
  const actualSha256 = createHash('sha256').update(bytes).digest('hex');
  if (actualSha256 !== reference.sha256) {
    throw new SessionLogPayloadResolutionError(
      'SHA256_MISMATCH',
      `External payload sha256 does not match its reference: ${reference.relativePath}.`,
      {
        relativePath: reference.relativePath,
        resolvedPath: payloadPath,
        expected: reference.sha256,
        actual: actualSha256,
      },
    );
  }
}

function getCanonicalPayloadPath(relativePath: string, lexicalPath: string): string {
  try {
    return realpathSync(lexicalPath);
  } catch (error) {
    throw fileAccessError(error, relativePath, lexicalPath);
  }
}

function getCanonicalBaseDirectory(state: IExternalPayloadFileState): string {
  if (state.canonicalBaseDirectory !== undefined) return state.canonicalBaseDirectory;
  try {
    state.canonicalBaseDirectory = realpathSync(state.baseDirectory);
    return state.canonicalBaseDirectory;
  } catch (error) {
    throw new SessionLogPayloadResolutionError(
      'PAYLOAD_UNREADABLE',
      `External-payload base directory could not be resolved: ${state.baseDirectory}.`,
      { resolvedPath: state.baseDirectory },
      error,
    );
  }
}

function fileAccessError(
  error: unknown,
  relativePath: string,
  resolvedPath: string,
): SessionLogPayloadResolutionError {
  const code = getNodeErrorCode(error);
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return new SessionLogPayloadResolutionError(
      'PAYLOAD_NOT_FOUND',
      `External payload was not found: ${relativePath}.`,
      { relativePath, resolvedPath },
      error,
    );
  }
  return new SessionLogPayloadResolutionError(
    'PAYLOAD_UNREADABLE',
    `External payload could not be resolved: ${relativePath}.`,
    { relativePath, resolvedPath },
    error,
  );
}

function getNodeErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

function outsideRootError(
  relativePath: string,
  resolvedPath?: string,
): SessionLogPayloadResolutionError {
  return new SessionLogPayloadResolutionError(
    'OUTSIDE_ROOT',
    `External payload path escapes its base directory: ${relativePath}.`,
    { relativePath, resolvedPath },
  );
}

function isWithin(root: string, candidate: string): boolean {
  const difference = relative(root, candidate);
  return (
    difference === '' ||
    (!difference.startsWith(`..${sep}`) && difference !== '..' && !isAbsolute(difference))
  );
}
