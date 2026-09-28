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

import type { IProviderFailureDetails, TErrorContextData } from './errors';

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

/**
 * A vendor message that names the model itself as the problem — the other half of "does the vendor
 * say this is about the model" beside a `model_not_found`-style code/type. Written from real vendor
 * text, not a guess: Anthropic's bare 404 body is just `model: <name>`, no "not found" wording and no
 * distinguishing code at all; Gemini's is `models/<name> is not found for API version ...`. Neither
 * pattern fires on an unrelated 404 body such as an openai-compatible self-hosted gateway's
 * `Cannot POST /wrong/path/chat/completions`, which names no model.
 *
 * `model:` is deliberately not anchored to the start of the message: the Stainless SDKs (Anthropic,
 * OpenAI) fold the whole parsed body into `Error.message` as `${status} ${JSON.stringify(body)}` — so
 * the vendor's own `"message":"model: claude-x"` shows up mid-string, quoted, not as the first thing
 * in the text. A JSON *key* named `model` never matches: it is followed by a closing quote before the
 * colon (`"model":`), not by `model:` directly.
 */
const MODEL_NOT_FOUND_MESSAGE_PATTERNS: readonly RegExp[] = [
  /\bmodel:\s*\S/i,
  /\bmodels?\b[^.\n]{0,80}\b(?:not found|does not exist|doesn't exist|is not available|not available|unavailable|unrecognized|not recognized|unknown)\b/i,
  /\b(?:no such model|unknown model|invalid model|unrecognized model|model not found)\b/i,
];

function messageNamesUnavailableModel(message: string): boolean {
  return MODEL_NOT_FOUND_MESSAGE_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Value characters a credential token is made of — stops at whitespace, a closing quote, and at the
 * punctuation that ends a sentence or closes a parenthetical around it, so only the token itself is
 * replaced and whatever comes after it (a closing quote or paren, a comma, the rest of the sentence)
 * survives untouched.
 */
const SECRET_VALUE = '[^\\s,;)"]+';

/**
 * Strip anything that reads like a credential out of vendor text before it is kept on a typed error.
 * A vendor's error body is not supposed to echo request headers, but a misconfigured self-hosted
 * gateway can bounce the raw request back (an `Authorization` header, a `Bearer` token, an `api_key=`
 * query parameter, or the whole request re-serialized as JSON) — this runs once, ahead of every
 * classification below, so nothing built from `message` (the wire frame's `message`, a GUI "Details"
 * disclosure) can leak one.
 *
 * Each pattern gets its own fixed replacement, bounded to the credential token — never a shared
 * callback keyed on "does this match have a capture group", which for a pattern with none receives
 * the match's numeric offset instead of `undefined` and silently prints that number.
 *
 * The key-name and value quotes are each optional and captured (`(")?`) rather than matched and
 * dropped: JSON re-serializes a header as `"Authorization": "Bearer sk-..."`, and the closing quote
 * right after the key name breaks a match that only expects `\s*[:=]` next — capturing it lets the
 * replacement echo it back (`Authorization$1: $2[REDACTED]`) so quoted and unquoted text both read
 * naturally, and `SECRET_VALUE` excluding `"` leaves a closing value quote alone to survive untouched.
 */
export function scrubSecrets(text: string): string {
  return text
    .replace(
      new RegExp(
        `\\bauthorization(")?\\s*[:=]\\s*(")?(?:(?:bearer|basic)\\s+)?${SECRET_VALUE}`,
        'gi',
      ),
      'Authorization$1: $2[REDACTED]',
    )
    // A bare `Bearer <token>` with no `Authorization:` prefix — the pattern above already consumed
    // that combined form, so this only fires standalone.
    .replace(new RegExp(`\\bbearer\\s+${SECRET_VALUE}`, 'gi'), 'Bearer [REDACTED]')
    // api_key / api-key / apikey / x-api-key / x-goog-api-key: the `\b` boundary lets an `x-` or
    // `x-goog-` prefix stay as literal, untouched text ahead of the match, so it survives in the
    // output exactly as written (`x-goog-` + `api-key": "[REDACTED]` reads as `x-goog-api-key": "[REDACTED]`).
    .replace(
      new RegExp(`\\b(api[-_]?key)(")?\\s*[:=]\\s*(")?${SECRET_VALUE}`, 'gi'),
      '$1$2: $3[REDACTED]',
    )
    // A `key=` query parameter (e.g. a Google-style `?key=AIza...`) not already covered above.
    .replace(new RegExp(`\\bkey=${SECRET_VALUE}`, 'gi'), 'key=[REDACTED]')
    // A bare secret key token, Anthropic's `sk-ant-...` included.
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/gi, '[REDACTED]')
    // A bare Google API key token, e.g. one echoed back with no "api_key"/"key=" label around it.
    .replace(/\bAIza[0-9A-Za-z_-]{35}\b/g, '[REDACTED]');
}

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
 * Seconds until a rate-limited request may retry, from a `retry-after` response header — a delta in
 * seconds (every vendor here sends this form) or, per the HTTP spec, an HTTP-date. The Stainless SDKs
 * (Anthropic, OpenAI) attach the header set differently: Anthropic's `headers` is a Web `Headers`
 * instance, OpenAI's is a plain lower-cased object. Undefined when the error carries no headers at
 * all (Gemini's SDK exposes none) or none of the shapes above name the header.
 */
function readRetryAfterSeconds(error: unknown): number | undefined {
  const headers = asRecord(error)?.['headers'];
  const raw =
    headers instanceof Headers
      ? headers.get('retry-after')
      : ((asRecord(headers)?.['retry-after'] ?? asRecord(headers)?.['Retry-After']) as
          string | undefined);
  // An empty header (`retry-after: ` with nothing after it) is absent in every way that matters —
  // `Number('')` is 0, which would otherwise read as "retry immediately" instead of "unknown".
  if (raw === undefined || raw === null || raw.trim().length === 0) return undefined;
  const asSeconds = Number(raw);
  if (Number.isFinite(asSeconds)) return Math.max(0, asSeconds);
  const asDate = Date.parse(raw);
  return Number.isNaN(asDate) ? undefined : Math.max(0, Math.round((asDate - Date.now()) / 1000));
}

/** `{ status, type }`, when the vendor gave either — the shared shape kept on every classified error. */
function failureContext(details: IProviderFailureDetails): TErrorContextData | undefined {
  if (details.status === undefined && details.type === undefined) return undefined;
  return {
    ...(details.status !== undefined && { status: details.status }),
    ...(details.type !== undefined && { type: details.type }),
  };
}

/**
 * Turn whatever an adapter caught into a typed provider failure.
 *
 * Aborts and errors already in the taxonomy pass through unchanged. Everything else is classified by
 * the same status/type rules `classifyLayer` uses to decide switchability — a rate limit, an
 * authentication failure, a model the vendor does not serve, and a transport failure each become
 * their own typed error (so `AuthenticationError`/`ModelNotAvailableError`/`NetworkError` are actually
 * thrown, not just recognized after the fact); anything left over becomes a `ProviderError` carrying
 * the status and type the vendor reported, with the original kept as `originalError`. Every branch
 * keeps the vendor's own (scrubbed) message and status/type — as the text baked into `message` for
 * the types that already carry a free-form one, and as `context` alongside it — so a "Details"
 * disclosure built from `message` downstream never has less to say than the vendor did.
 */
export function toProviderError(error: unknown, provider: string, operation: string): Error {
  if (error instanceof RobotaError || isAbort(error)) return error as Error;
  const originalError =
    error instanceof Error ? error : new Error(typeof error === 'string' ? error : '');
  const details = readProviderFailureDetails(error);
  const message = scrubSecrets(originalError.message || 'request failed');
  const context = failureContext(details);

  if (
    details.status === HTTP_TOO_MANY_REQUESTS ||
    (details.type !== undefined && RATE_LIMIT_TYPES.has(details.type))
  ) {
    return new RateLimitError(
      message || `${provider} rate limit exceeded.`,
      readRetryAfterSeconds(error),
      provider,
      context,
    );
  }
  if (
    details.status === HTTP_UNAUTHORIZED ||
    details.status === HTTP_FORBIDDEN ||
    (details.type !== undefined && AUTH_TYPES.has(details.type))
  ) {
    return new AuthenticationError(message, provider, context);
  }
  // Classify as the model only when the vendor actually names it as the problem: a
  // `model_not_found`-style code/type, or a message that says so (see
  // MODEL_NOT_FOUND_MESSAGE_PATTERNS — Anthropic's and Gemini's real bodies, which carry no
  // distinguishing code). A bare 404/400 with neither signal — e.g. a mistyped self-hosted endpoint's
  // "Cannot POST /wrong/path" — falls through to the generic ProviderError below instead of being
  // misread as "no such model", keeping its real text and status.
  const bareStatus =
    details.status === undefined ||
    details.status === HTTP_BAD_REQUEST ||
    details.status === HTTP_NOT_FOUND;
  const namesUnavailableModel =
    hasModelUnavailableCode(error) ||
    (details.type !== undefined && MODEL_UNAVAILABLE_CODES.has(details.type)) ||
    messageNamesUnavailableModel(message);
  if (bareStatus && namesUnavailableModel) {
    return new ModelNotAvailableError(undefined, provider, undefined, {
      ...context,
      originalMessage: message,
    });
  }
  if (isNetworkFailure(error)) {
    return new NetworkError(message, originalError, context, provider);
  }
  return new ProviderError(`${operation}: ${message}`, provider, originalError, undefined, details);
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
