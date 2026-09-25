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
const MAX_WRAP_DEPTH = 8;
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

type TLayerVerdict =
  | { kind: 'definitive'; classification: IProviderFailureClassification }
  /** A bare 400/404: a deeper `model_not_found` code may still say more precisely what failed. */
  | { kind: 'tentative'; classification: IProviderFailureClassification }
  | { kind: 'none' };

const definitive = (switchable: boolean, reason: TProviderFailureReason): TLayerVerdict => ({
  kind: 'definitive',
  classification: { switchable, reason },
});

function detailsOf(layer: unknown): IProviderFailureDetails {
  if (!(layer instanceof ProviderError)) return readProviderFailureDetails(layer);
  return {
    ...(layer.status !== undefined && { status: layer.status }),
    ...(layer.type !== undefined && { type: layer.type }),
  };
}

function hasModelUnavailableCode(layer: unknown): boolean {
  if (layer instanceof RobotaError) return false;
  const code = stringField(asRecord(layer), 'code');
  return code !== undefined && MODEL_UNAVAILABLE_CODES.has(code);
}

/**
 * What one layer says on its own. The order is the precedence: what the error IS, then the
 * failures no other model fixes (auth, rate limit, billing), then a model the vendor names as
 * unknown, then a transport failure, then the remaining statuses.
 */
function classifyLayer(layer: unknown): TLayerVerdict {
  if (layer instanceof RateLimitError) return definitive(false, 'rate-limit');
  if (layer instanceof AuthenticationError) return definitive(false, 'authentication');
  if (layer instanceof ModelNotAvailableError) return definitive(true, 'model-unavailable');

  const { status, type } = detailsOf(layer);
  if (status === HTTP_TOO_MANY_REQUESTS || (type !== undefined && RATE_LIMIT_TYPES.has(type))) {
    return definitive(false, 'rate-limit');
  }
  if (
    status === HTTP_UNAUTHORIZED ||
    status === HTTP_FORBIDDEN ||
    (type !== undefined && AUTH_TYPES.has(type))
  ) {
    return definitive(false, 'authentication');
  }
  if (status === HTTP_PAYMENT_REQUIRED) return definitive(false, 'billing');

  // OpenAI-compatible vendors send `code: 'model_not_found'` beside `type: 'invalid_request_error'`
  // on a 400, so the code outranks a bare 400/404 — and nothing else.
  const bareStatus =
    status === undefined || status === HTTP_BAD_REQUEST || status === HTTP_NOT_FOUND;
  if (
    bareStatus &&
    (hasModelUnavailableCode(layer) || (type !== undefined && MODEL_UNAVAILABLE_CODES.has(type)))
  ) {
    return definitive(true, 'model-unavailable');
  }

  if (isNetworkFailure(layer)) return definitive(false, 'network');

  if (status === HTTP_OVERLOADED || (type !== undefined && OVERLOADED_TYPES.has(type))) {
    return definitive(true, 'overloaded');
  }
  if (status === HTTP_SERVICE_UNAVAILABLE) return definitive(true, 'service-unavailable');
  if (
    status === HTTP_INTERNAL_SERVER_ERROR ||
    status === HTTP_BAD_GATEWAY ||
    status === HTTP_GATEWAY_TIMEOUT
  ) {
    return definitive(true, 'server-error');
  }
  // A chat endpoint's only addressable resource is the model, so its 404 means the model.
  if (status === HTTP_NOT_FOUND) {
    return { kind: 'tentative', classification: { switchable: true, reason: 'model-unavailable' } };
  }
  if (status === HTTP_BAD_REQUEST || status === HTTP_PAYLOAD_TOO_LARGE) {
    return { kind: 'tentative', classification: { switchable: false, reason: 'invalid-request' } };
  }
  return { kind: 'none' };
}

/**
 * Decide whether a failed provider call is worth retrying on a different model.
 *
 * Switchable: overload, 503, 500/502/504, and a model the provider does not serve — failures of
 * this model or this vendor's capacity. Not switchable: auth, billing, rate limit, a request the
 * vendor rejected as malformed or too large, a transport failure, an abort, and anything
 * unrecognized — another model would fail the same way, the caller asked to stop, or nobody knows.
 *
 * An abort anywhere wins, because the caller asked to stop. Otherwise the outermost layer that says
 * something decides, so a wrapper's own verdict (a rate limit, a dropped connection) is never
 * overridden by a switchable status buried underneath it; a wrapper that says nothing lets the
 * layers underneath speak.
 */
export function classifyProviderFailure(
  error: unknown,
  signal?: AbortSignal,
): IProviderFailureClassification {
  const layers = layersOf(error);
  if (signal?.aborted === true || layers.some((layer) => isAbort(layer))) {
    return { switchable: false, reason: 'aborted' };
  }
  let tentative: IProviderFailureClassification | undefined;
  for (const layer of layers) {
    const verdict = classifyLayer(layer);
    if (verdict.kind === 'none') continue;
    if (tentative === undefined && verdict.kind === 'definitive') return verdict.classification;
    if (tentative === undefined) {
      tentative = verdict.classification;
      continue;
    }
    // Under a bare 400/404/413, the first deeper layer that decides settles it: only a precise
    // "no such model" refines the verdict; any other decision keeps it.
    if (verdict.kind === 'definitive') {
      return verdict.classification.reason === 'model-unavailable'
        ? verdict.classification
        : tentative;
    }
  }
  return tentative ?? { switchable: false, reason: 'unknown' };
}
