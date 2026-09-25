/**
 * Provider failures, read from what the vendor reported rather than from message prose.
 *
 * `toProviderError` is what an adapter's catch block uses so the HTTP status and the vendor's
 * error type survive the adapter boundary. `classifyProviderFailure` answers one question from
 * those facts: could the same request plausibly succeed on a different model?
 */

import { isAbortFailure } from './abort-classification';
import {
  AuthenticationError,
  ModelNotAvailableError,
  NetworkError,
  ProviderError,
  RateLimitError,
  RobotaError,
} from './errors';

import type { IProviderFailureDetails } from './errors';

const HTTP_BAD_REQUEST = 400;
const HTTP_UNAUTHORIZED = 401;
const HTTP_PAYMENT_REQUIRED = 402;
const HTTP_FORBIDDEN = 403;
const HTTP_NOT_FOUND = 404;
const HTTP_PAYLOAD_TOO_LARGE = 413;
const HTTP_TOO_MANY_REQUESTS = 429;
const HTTP_INTERNAL_SERVER_ERROR = 500;
const HTTP_BAD_GATEWAY = 502;
const HTTP_SERVICE_UNAVAILABLE = 503;
const HTTP_GATEWAY_TIMEOUT = 504;
const HTTP_OVERLOADED = 529;

const RATE_LIMIT_TYPES: ReadonlySet<string> = new Set(['rate_limit_error']);
const OVERLOADED_TYPES: ReadonlySet<string> = new Set(['overloaded_error']);
const AUTH_TYPES: ReadonlySet<string> = new Set(['authentication_error', 'permission_error']);
const MODEL_UNAVAILABLE_CODES: ReadonlySet<string> = new Set(['model_not_found']);
const NETWORK_ERROR_CODES: ReadonlySet<string> = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
]);
const SDK_ABORT_CLASS = 'APIUserAbortError';
const MAX_WRAP_DEPTH = 4;
const NETWORK_ERROR_CLASSES: ReadonlySet<string> = new Set([
  'APIConnectionError',
  'APIConnectionTimeoutError',
]);

/** Why a provider call failed, as far as switching models is concerned. */
export type TProviderFailureReason =
  | 'overloaded'
  | 'service-unavailable'
  | 'server-error'
  | 'model-unavailable'
  | 'authentication'
  | 'billing'
  | 'rate-limit'
  | 'invalid-request'
  | 'network'
  | 'aborted'
  | 'unknown';

export interface IProviderFailureClassification {
  /** True when another model could plausibly serve the same request. */
  switchable: boolean;
  reason: TProviderFailureReason;
}

type TErrorRecord = Record<string, unknown>;

function asRecord(value: unknown): TErrorRecord | undefined {
  return typeof value === 'object' && value !== null ? (value as TErrorRecord) : undefined;
}

function stringField(record: TErrorRecord | undefined, key: string): string | undefined {
  const value = record?.[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Read the HTTP status and vendor error type off an SDK error.
 *
 * The SDKs disagree on where the type lives: `error.type` (Anthropic, OpenAI), the parsed body at
 * `error.error.type` (OpenAI) or `error.error.error.type` (Anthropic, whose body is
 * `{ type: 'error', error: { type } }`). On an HTTP error with no type, a `code` such as OpenAI's
 * `model_not_found` stands in for it.
 */
export function readProviderFailureDetails(error: unknown): IProviderFailureDetails {
  const record = asRecord(error);
  if (record === undefined) return {};
  const status = typeof record['status'] === 'number' ? record['status'] : undefined;
  const body = asRecord(record['error']);
  const nested = asRecord(body?.['error']);
  const bodyType = stringField(body, 'type');
  const type =
    stringField(record, 'type') ??
    stringField(nested, 'type') ??
    (bodyType === 'error' ? undefined : bodyType) ??
    (status !== undefined && !(error instanceof RobotaError)
      ? stringField(record, 'code')
      : undefined);
  return {
    ...(status !== undefined && { status }),
    ...(type !== undefined && { type }),
  };
}

/**
 * The name of the class that built this value. The Stainless SDKs (OpenAI, Anthropic) never set
 * `name` on their error classes, so `name` reads `'Error'`; the constructor name is what tells an
 * `APIUserAbortError` or an `APIConnectionError` apart. Checked by name, not `instanceof`, because
 * this package depends on no vendor SDK and each provider may load its own copy of one.
 */
function className(value: unknown): string | undefined {
  const ctor = asRecord(value)?.['constructor'];
  if (typeof ctor !== 'function') return undefined;
  const name = (ctor as { name?: unknown }).name;
  return typeof name === 'string' && name.length > 0 ? name : undefined;
}

/** An abort, including the SDKs' own `APIUserAbortError`, whose `name` is not `'AbortError'`. */
function isAbort(value: unknown): boolean {
  return isAbortFailure(value) || className(value) === SDK_ABORT_CLASS;
}

/**
 * Turn whatever an adapter caught into a typed provider failure.
 *
 * Aborts and errors already in the taxonomy pass through unchanged, a rate limit becomes a
 * `RateLimitError`, and anything else becomes a `ProviderError` carrying the status and type the
 * vendor reported, with the original kept as `originalError`.
 */
export function toProviderError(error: unknown, provider: string, operation: string): Error {
  if (error instanceof RobotaError || isAbort(error)) return error as Error;
  const originalError =
    error instanceof Error ? error : new Error(typeof error === 'string' ? error : '');
  const details = readProviderFailureDetails(error);
  if (
    details.status === HTTP_TOO_MANY_REQUESTS ||
    (details.type !== undefined && RATE_LIMIT_TYPES.has(details.type))
  ) {
    return new RateLimitError(
      originalError.message || `${provider} rate limit exceeded.`,
      undefined,
      provider,
    );
  }
  const reason = originalError.message || 'request failed';
  return new ProviderError(`${operation}: ${reason}`, provider, originalError, undefined, details);
}

function isNetworkFailure(error: unknown): boolean {
  if (error instanceof NetworkError) return true;
  const record = asRecord(error);
  if (record === undefined) return false;
  const code = stringField(record, 'code');
  if (code !== undefined && NETWORK_ERROR_CODES.has(code)) return true;
  const ctorName = className(error);
  if (ctorName !== undefined && NETWORK_ERROR_CLASSES.has(ctorName)) return true;
  const name = stringField(record, 'name');
  if (name !== undefined && NETWORK_ERROR_CLASSES.has(name)) return true;
  // undici's fetch rejects a transport failure as `TypeError: fetch failed`.
  return name === 'TypeError' && stringField(record, 'message') === 'fetch failed';
}

/**
 * The error and everything it wraps, outermost first: `originalError` (the taxonomy's wrappers) and
 * `cause` (the platform's and the SDKs'), followed to a small depth and never twice.
 */
function layersOf(error: unknown): unknown[] {
  const layers: unknown[] = [];
  const seen = new Set<unknown>();
  let frontier: unknown[] = [error];
  for (let depth = 0; depth <= MAX_WRAP_DEPTH && frontier.length > 0; depth++) {
    const next: unknown[] = [];
    for (const layer of frontier) {
      if (layer === undefined || layer === null || seen.has(layer)) continue;
      seen.add(layer);
      layers.push(layer);
      const record = asRecord(layer);
      if (record !== undefined) next.push(record['originalError'], record['cause']);
    }
    frontier = next;
  }
  return layers;
}

function classifyByDetails(details: IProviderFailureDetails): IProviderFailureClassification {
  const { status, type } = details;
  if (status === HTTP_OVERLOADED || (type !== undefined && OVERLOADED_TYPES.has(type))) {
    return { switchable: true, reason: 'overloaded' };
  }
  if (status === HTTP_TOO_MANY_REQUESTS || (type !== undefined && RATE_LIMIT_TYPES.has(type))) {
    return { switchable: false, reason: 'rate-limit' };
  }
  if (
    status === HTTP_UNAUTHORIZED ||
    status === HTTP_FORBIDDEN ||
    (type !== undefined && AUTH_TYPES.has(type))
  ) {
    return { switchable: false, reason: 'authentication' };
  }
  if (status === HTTP_PAYMENT_REQUIRED) return { switchable: false, reason: 'billing' };
  if (status === HTTP_SERVICE_UNAVAILABLE) {
    return { switchable: true, reason: 'service-unavailable' };
  }
  if (
    status === HTTP_INTERNAL_SERVER_ERROR ||
    status === HTTP_BAD_GATEWAY ||
    status === HTTP_GATEWAY_TIMEOUT
  ) {
    return { switchable: true, reason: 'server-error' };
  }
  // A chat endpoint's only addressable resource is the model, so its 404 means the model.
  if (status === HTTP_NOT_FOUND || (type !== undefined && MODEL_UNAVAILABLE_CODES.has(type))) {
    return { switchable: true, reason: 'model-unavailable' };
  }
  if (status === HTTP_BAD_REQUEST || status === HTTP_PAYLOAD_TOO_LARGE) {
    return { switchable: false, reason: 'invalid-request' };
  }
  return { switchable: false, reason: 'unknown' };
}

function classifyLayer(layer: unknown): IProviderFailureClassification {
  if (layer instanceof RateLimitError) return { switchable: false, reason: 'rate-limit' };
  if (layer instanceof AuthenticationError) return { switchable: false, reason: 'authentication' };
  if (layer instanceof ModelNotAvailableError) {
    return { switchable: true, reason: 'model-unavailable' };
  }
  return classifyByDetails(
    layer instanceof ProviderError
      ? {
          ...(layer.status !== undefined && { status: layer.status }),
          ...(layer.type !== undefined && { type: layer.type }),
        }
      : readProviderFailureDetails(layer),
  );
}

/**
 * Whether any layer names, by its `code`, a model the vendor does not serve. OpenAI-compatible
 * vendors send `code: 'model_not_found'` beside `type: 'invalid_request_error'` on a 400, so the
 * code outranks a status and type that would otherwise read as a malformed request.
 */
function hasModelUnavailableCode(layers: readonly unknown[]): boolean {
  return layers.some((layer) => {
    if (layer instanceof RobotaError) return false;
    const code = stringField(asRecord(layer), 'code');
    return code !== undefined && MODEL_UNAVAILABLE_CODES.has(code);
  });
}

/**
 * Decide whether a failed provider call is worth retrying on a different model.
 *
 * Switchable: overload, 503, 500/502/504, and a model the provider does not serve — failures of
 * this model or this vendor's capacity. Not switchable: auth, billing, rate limit, a request the
 * vendor rejected as malformed or too large, a transport failure, an abort, and anything
 * unrecognized — another model would fail the same way, the caller asked to stop, or nobody knows.
 * Every wrapped layer is read, outermost first, so a wrapper that adds no facts of its own does not
 * hide the ones underneath it.
 */
export function classifyProviderFailure(
  error: unknown,
  signal?: AbortSignal,
): IProviderFailureClassification {
  const layers = layersOf(error);
  if (signal?.aborted === true || layers.some((layer) => isAbort(layer))) {
    return { switchable: false, reason: 'aborted' };
  }
  if (hasModelUnavailableCode(layers)) return { switchable: true, reason: 'model-unavailable' };
  for (const layer of layers) {
    const classification = classifyLayer(layer);
    if (classification.reason !== 'unknown') return classification;
  }
  if (layers.some((layer) => isNetworkFailure(layer))) {
    return { switchable: false, reason: 'network' };
  }
  return { switchable: false, reason: 'unknown' };
}
