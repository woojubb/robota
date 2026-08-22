import { createHash } from 'node:crypto';

import { validateExternalPayloadReference } from './external-payload-file-reader.js';
import { SessionLogPayloadResolutionError } from './external-payload-resolution-contracts.js';

import type { ISessionLogPayloadResolutionOptions } from './external-payload-resolution-contracts.js';
import type { IExternalPayloadSource } from './session-log-sources.js';
import type { IExternalPayloadReference } from './session-logger.js';

export { SessionLogPayloadResolutionError } from './external-payload-resolution-contracts.js';
export type {
  ISessionLogPayloadResolutionErrorMetadata,
  ISessionLogPayloadResolutionOptions,
  TSessionLogPayloadResolutionErrorCode,
} from './external-payload-resolution-contracts.js';

const DEFAULT_MAX_DEPTH = 32;
const DEFAULT_MAX_TOTAL_MIB = 64;
const BYTES_PER_KIB = 1024;
const KIB_PER_MIB = 1024;
const DEFAULT_MAX_TOTAL_BYTES = DEFAULT_MAX_TOTAL_MIB * KIB_PER_MIB * BYTES_PER_KIB;

interface IResolutionState {
  readonly maxDepth: number;
  readonly maxTotalBytes: number;
  readonly source: IExternalPayloadSource | undefined;
  totalBytes: number;
  readonly activePayloadPaths: Set<string>;
  readonly activeObjects: WeakSet<object>;
}

/**
 * Hydrate every external JSON payload reference in one value using one aggregate budget.
 * The input is treated as untrusted and the returned graph contains only JSON-compatible values.
 */
export function resolveSessionLogExternalPayloads(
  value: unknown,
  options: ISessionLogPayloadResolutionOptions,
): unknown {
  const state = createResolutionState(options);
  return resolveValue(value, state, 0);
}

function createResolutionState(options: ISessionLogPayloadResolutionOptions): IResolutionState {
  const maxDepth = validateLimit('maxDepth', options.maxDepth ?? DEFAULT_MAX_DEPTH);
  const maxTotalBytes = validateLimit(
    'maxTotalBytes',
    options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES,
  );
  return {
    source: options.source,
    maxDepth,
    maxTotalBytes,
    totalBytes: 0,
    activePayloadPaths: new Set<string>(),
    activeObjects: new WeakSet<object>(),
  };
}

function validateLimit(name: string, value: number): number {
  if (!Number.isFinite(value) || !Number.isSafeInteger(value) || value < 0) {
    throw new SessionLogPayloadResolutionError(
      'INVALID_LIMIT',
      `${name} must be a finite, non-negative safe integer.`,
      { actual: String(value) },
    );
  }
  return value;
}

function resolveValue(value: unknown, state: IResolutionState, referenceDepth: number): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return value;
  }
  if (typeof value === 'number') {
    throw invalidJsonValue('Non-finite numbers are not valid session-log JSON values.');
  }
  if (typeof value !== 'object') {
    throw invalidJsonValue(`Unsupported session-log JSON value type: ${typeof value}.`);
  }
  if (state.activeObjects.has(value)) {
    throw new SessionLogPayloadResolutionError(
      'CIRCULAR_REFERENCE',
      'Circular in-memory value encountered while resolving external payloads.',
      { depth: referenceDepth },
    );
  }
  if (isPotentialExternalPayloadReference(value)) {
    return resolveReference(value, state, referenceDepth);
  }
  if (Array.isArray(value)) {
    state.activeObjects.add(value);
    try {
      return value.map((item) => resolveValue(item, state, referenceDepth));
    } finally {
      state.activeObjects.delete(value);
    }
  }
  if (!isPlainRecord(value)) {
    throw invalidJsonValue('Session-log payload objects must be plain JSON records.');
  }
  state.activeObjects.add(value);
  try {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        resolveValue(child, state, referenceDepth),
      ]),
    );
  } finally {
    state.activeObjects.delete(value);
  }
}

function resolveReference(
  value: Record<string, unknown>,
  state: IResolutionState,
  referenceDepth: number,
): unknown {
  const reference = validateExternalPayloadReference(value);
  if (referenceDepth >= state.maxDepth) {
    throw new SessionLogPayloadResolutionError(
      'MAX_DEPTH_EXCEEDED',
      `External-payload reference depth exceeds the configured maximum of ${state.maxDepth}.`,
      { relativePath: reference.relativePath, depth: referenceDepth },
    );
  }
  if (state.source === undefined) {
    throw new SessionLogPayloadResolutionError(
      'UNRESOLVED_REFERENCE',
      'An external session-log payload requires an explicit payload source.',
      { relativePath: reference.relativePath, depth: referenceDepth },
    );
  }
  if (state.activePayloadPaths.has(reference.relativePath)) {
    throw new SessionLogPayloadResolutionError(
      'CIRCULAR_REFERENCE',
      `External payload ${reference.relativePath} recursively references an active payload.`,
      { relativePath: reference.relativePath, depth: referenceDepth },
    );
  }

  const parsed = readExternalPayloadJson(reference, state);
  state.activePayloadPaths.add(reference.relativePath);
  try {
    return resolveValue(parsed, state, referenceDepth + 1);
  } finally {
    state.activePayloadPaths.delete(reference.relativePath);
  }
}

function readExternalPayloadJson(
  reference: IExternalPayloadReference,
  state: IResolutionState,
): unknown {
  const remainingBytes = state.maxTotalBytes - state.totalBytes;
  const bytes = state.source?.readBytes(reference.relativePath, remainingBytes);
  if (bytes === undefined) {
    throw new SessionLogPayloadResolutionError(
      'PAYLOAD_NOT_FOUND',
      `External payload was not found: ${reference.relativePath}.`,
      { relativePath: reference.relativePath },
    );
  }
  const nextTotalBytes = state.totalBytes + bytes.byteLength;
  if (!Number.isSafeInteger(nextTotalBytes) || nextTotalBytes > state.maxTotalBytes) {
    throw new SessionLogPayloadResolutionError(
      'MAX_TOTAL_BYTES_EXCEEDED',
      `External-payload bytes exceed the configured maximum of ${state.maxTotalBytes}.`,
      { expected: state.maxTotalBytes, actual: nextTotalBytes },
    );
  }
  state.totalBytes = nextTotalBytes;
  if (bytes.byteLength !== reference.byteLength) {
    throw new SessionLogPayloadResolutionError(
      'BYTE_LENGTH_MISMATCH',
      `External payload byte length does not match its reference: ${reference.relativePath}.`,
      {
        relativePath: reference.relativePath,
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
      { relativePath: reference.relativePath, expected: reference.sha256, actual: actualSha256 },
    );
  }
  try {
    return JSON.parse(Buffer.from(bytes).toString('utf8')) as unknown;
  } catch (error) {
    throw new SessionLogPayloadResolutionError(
      'INVALID_JSON',
      `External payload is not valid JSON: ${reference.relativePath}.`,
      { relativePath: reference.relativePath },
      error,
    );
  }
}

function invalidJsonValue(message: string): SessionLogPayloadResolutionError {
  return new SessionLogPayloadResolutionError('INVALID_JSON', message);
}

function isPotentialExternalPayloadReference(value: object): value is Record<string, unknown> {
  return !Array.isArray(value) && 'kind' in value && value.kind === 'external-payload';
}

function isPlainRecord(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
