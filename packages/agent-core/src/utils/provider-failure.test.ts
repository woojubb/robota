import { describe, expect, it } from 'vitest';

import {
  AuthenticationError,
  ModelNotAvailableError,
  NetworkError,
  ProviderError,
  RateLimitError,
} from './errors';
import {
  classifyProviderFailure,
  readProviderFailureDetails,
  scrubSecrets,
  toProviderError,
} from './provider-failure';

import type { TProviderFailureReason } from './provider-failure';

function httpError(status: number, type?: string): ProviderError {
  return new ProviderError(`HTTP ${status}`, 'test', undefined, undefined, {
    status,
    ...(type !== undefined && { type }),
  });
}

/**
 * Shaped like the Stainless SDKs' error classes (OpenAI, Anthropic): the class is named, but
 * `name` stays `'Error'`. The provider packages test the real classes.
 */
class APIUserAbortErrorShape extends Error {}
Object.defineProperty(APIUserAbortErrorShape, 'name', { value: 'APIUserAbortError' });
class ApiConnectionErrorShape extends Error {}
Object.defineProperty(ApiConnectionErrorShape, 'name', { value: 'APIConnectionError' });

function wrapped(inner: Error): ProviderError {
  return new ProviderError('Conversation failed', 'conversation', inner);
}

/** An OpenAI-compatible vendor's "no such model", with the given HTTP status. */
function modelNotFound(status: number): Error {
  return Object.assign(withCode('The model does not exist', 'model_not_found'), {
    status,
    type: 'invalid_request_error',
  });
}

function withCode(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

describe('ProviderError details', () => {
  it('keeps the HTTP status and vendor type it was given', () => {
    const error = httpError(529, 'overloaded_error');
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.status).toBe(529);
    expect(error.type).toBe('overloaded_error');
    expect(error.message).toBe('Provider Error (test): HTTP 529');
  });

  it('still constructs without details', () => {
    const error = new ProviderError('failed', 'openai');
    expect(error.status).toBeUndefined();
    expect(error.type).toBeUndefined();
  });
});

describe('readProviderFailureDetails', () => {
  it('reads an Anthropic SDK error, whose body nests the type', () => {
    const sdkError = Object.assign(new Error('529 Overloaded'), {
      status: 529,
      error: { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
    });
    expect(readProviderFailureDetails(sdkError)).toEqual({
      status: 529,
      type: 'overloaded_error',
    });
  });

  it('uses an HTTP error code when there is no type', () => {
    expect(
      readProviderFailureDetails(Object.assign(withCode('x', 'model_not_found'), { status: 404 })),
    ).toEqual({
      status: 404,
      type: 'model_not_found',
    });
  });

  it('does not mistake a socket error code for a vendor type', () => {
    expect(readProviderFailureDetails(withCode('reset', 'ECONNRESET'))).toEqual({});
  });
});

describe('scrubSecrets', () => {
  // The previous implementation shared one replace callback across every pattern and keyed its
  // output on whether `group` was `undefined` — but for a pattern with no capture group, `replace`
  // passes the match's numeric OFFSET as that argument, not `undefined`, so the check was always
  // true and the offset itself leaked into the output (e.g. `"...(25: [REDACTED]"`, dropping the
  // rest of the line as well since the `authorization` pattern also read to the end of the string).
  it('redacts only the credential in an Authorization header, keeping what comes after it', () => {
    expect(
      scrubSecrets('Cannot POST /wrong/path (Authorization: Bearer sk-live-should-not-leak)'),
    ).toBe('Cannot POST /wrong/path (Authorization: [REDACTED])');
  });

  it('keeps the rest of the sentence after a mid-message Authorization header', () => {
    expect(
      scrubSecrets(
        'Request failed: Authorization: Bearer sk-live-abcd1234, but also note … ' +
          'Please update your integration.',
      ),
    ).toBe(
      'Request failed: Authorization: [REDACTED], but also note … Please update your integration.',
    );
  });

  it('redacts a standalone Bearer token with no Authorization: prefix', () => {
    expect(scrubSecrets('token used: Bearer sk-live-standalone-token here')).toBe(
      'token used: Bearer [REDACTED] here',
    );
  });

  it('redacts api_key / api-key / apikey / x-api-key / x-goog-api-key, keeping the header name', () => {
    expect(scrubSecrets('Gateway rejected api_key=sk-proj-abc123 for this request.')).toBe(
      'Gateway rejected api_key: [REDACTED] for this request.',
    );
    expect(scrubSecrets('header apikey: abc.def.ghi denied')).toBe(
      'header apikey: [REDACTED] denied',
    );
    expect(scrubSecrets('curl error: x-goog-api-key: AIzaSyABCDEF1234567890 was rejected')).toBe(
      'curl error: x-goog-api-key: [REDACTED] was rejected',
    );
    expect(scrubSecrets('refused: x-api-key=abcdef123456')).toBe('refused: x-api-key: [REDACTED]');
  });

  it('redacts a key= query parameter', () => {
    expect(scrubSecrets('Blocked request to /v1/models?key=AIzaSyDEMOKEY1234 from client')).toBe(
      'Blocked request to /v1/models?key=[REDACTED] from client',
    );
  });

  it('redacts a bare secret key token, including sk-ant-...', () => {
    expect(scrubSecrets('Leaked token sk-live-abcdefgh1234 in log line')).toBe(
      'Leaked token [REDACTED] in log line',
    );
    expect(scrubSecrets('Leaked token sk-ant-api03-abcdefgh in log line')).toBe(
      'Leaked token [REDACTED] in log line',
    );
  });

  it('leaves an ordinary message with no secrets unchanged', () => {
    expect(scrubSecrets('503 Service Unavailable')).toBe('503 Service Unavailable');
  });

  it('does not hit ordinary hyphenated words that merely contain "sk"', () => {
    const benign = 'This risky, ask-first, desk-based task-runner workflow needs a review.';
    expect(scrubSecrets(benign)).toBe(benign);
  });
});

describe('toProviderError', () => {
  it('wraps an HTTP failure keeping status, type and the original error', () => {
    const sdkError = Object.assign(new Error('503 Service Unavailable'), { status: 503 });
    const error = toProviderError(sdkError, 'openai', 'OpenAI chat failed');
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).status).toBe(503);
    expect((error as ProviderError).originalError).toBe(sdkError);
    expect(error.message).toBe(
      'Provider Error (openai): OpenAI chat failed: 503 Service Unavailable',
    );
  });

  it('maps a 429 to RateLimitError', () => {
    const error = toProviderError(
      Object.assign(new Error('slow down'), { status: 429 }),
      'gemini',
      'Google chat failed',
    );
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).provider).toBe('gemini');
  });

  it('passes an abort and an error already in the taxonomy through unchanged', () => {
    const abort = new DOMException('aborted', 'AbortError');
    expect(toProviderError(abort, 'openai', 'op')).toBe(abort);
    const existing = new NetworkError('down');
    expect(toProviderError(existing, 'openai', 'op')).toBe(existing);
    const sdkAbort = new APIUserAbortErrorShape('Request was aborted.');
    expect(toProviderError(sdkAbort, 'anthropic', 'op')).toBe(sdkAbort);
  });

  it('maps a 401 to AuthenticationError, carrying the provider', () => {
    const error = toProviderError(
      Object.assign(new Error('invalid x-api-key'), { status: 401 }),
      'anthropic',
      'Anthropic request failed',
    );
    expect(error).toBeInstanceOf(AuthenticationError);
    expect((error as AuthenticationError).provider).toBe('anthropic');
    expect(error.message).toBe('Authentication Error: invalid x-api-key');
  });

  it('maps a 403 to AuthenticationError', () => {
    const error = toProviderError(
      Object.assign(new Error('permission denied'), { status: 403 }),
      'openai',
      'op',
    );
    expect(error).toBeInstanceOf(AuthenticationError);
  });

  it('maps an authentication_error type with no status to AuthenticationError', () => {
    const error = toProviderError(
      Object.assign(new Error('bad key'), { type: 'authentication_error' }),
      'anthropic',
      'op',
    );
    expect(error).toBeInstanceOf(AuthenticationError);
  });

  it('reads a retry-after header (Headers instance) into RateLimitError.retryAfter', () => {
    const error = toProviderError(
      Object.assign(new Error('slow down'), {
        status: 429,
        headers: new Headers({ 'retry-after': '30' }),
      }),
      'anthropic',
      'op',
    );
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfter).toBe(30);
  });

  it('reads a retry-after header (plain object) into RateLimitError.retryAfter', () => {
    const error = toProviderError(
      Object.assign(new Error('slow down'), { status: 429, headers: { 'retry-after': '5' } }),
      'openai',
      'op',
    );
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfter).toBe(5);
  });

  it('leaves retryAfter undefined when there is no retry-after header', () => {
    const error = toProviderError(
      Object.assign(new Error('slow down'), { status: 429 }),
      'gemini',
      'op',
    );
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfter).toBeUndefined();
  });

  it('maps a model_not_found code to ModelNotAvailableError', () => {
    const error = toProviderError(
      Object.assign(withCode('The model does not exist', 'model_not_found'), {
        status: 400,
        type: 'invalid_request_error',
      }),
      'deepseek',
      'op',
    );
    expect(error).toBeInstanceOf(ModelNotAvailableError);
    expect((error as ModelNotAvailableError).provider).toBe('deepseek');
  });

  // A mistyped self-hosted endpoint (e.g. an openai-compatible `baseURL`) returns a bare 404 whose
  // body names no model at all. Earlier, ANY bare 404 became ModelNotAvailableError, dropping the
  // real cause and reporting "the model isn't available with this key" for what is actually a wrong
  // URL. `error.message` here is exactly what reaches the wire `error` frame's `message` unchanged
  // (agent-transport's `subscribeSessionEvents` sends `message: error.message`) and, from there, the
  // GUI's "Details" disclosure — so this also proves those two keep the vendor's real text.
  it('keeps a bare 404 with no model-naming signal as a generic ProviderError', () => {
    const error = toProviderError(
      Object.assign(new Error('Cannot POST /wrong/path/chat/completions'), {
        status: 404,
        type: 'not_found_error',
      }),
      'openai-compatible',
      'op',
    );
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).not.toBeInstanceOf(ModelNotAvailableError);
    expect(error.message).toContain('Cannot POST /wrong/path/chat/completions');
  });

  // Anthropic's real not-found body is just `model: <name>` (no distinguishing code); Gemini's is
  // `models/<name> is not found for API version ...`. Either way the vendor names the model, so this
  // stays ModelNotAvailableError — and keeps the vendor's message instead of the old
  // `new ModelNotAvailableError(undefined, provider)`, which threw the text away entirely.
  it('maps a 404 that names the model as not found to ModelNotAvailableError, keeping the vendor message', () => {
    const error = toProviderError(
      Object.assign(new Error('model: claude-nonexistent'), { status: 404, type: 'not_found_error' }),
      'anthropic',
      'op',
    );
    expect(error).toBeInstanceOf(ModelNotAvailableError);
    expect(error.message).toContain('model: claude-nonexistent');
  });

  it('scrubs an API key or Authorization header out of the preserved vendor text, both ways', () => {
    const genericNotFound = toProviderError(
      Object.assign(
        new Error('Cannot POST /wrong/path (Authorization: Bearer sk-live-should-not-leak)'),
        { status: 404 },
      ),
      'openai-compatible',
      'op',
    );
    expect(genericNotFound).not.toBeInstanceOf(ModelNotAvailableError);
    expect(genericNotFound.message).not.toContain('sk-live-should-not-leak');

    const modelNotFound = toProviderError(
      Object.assign(new Error('model: claude-x not found (api_key=sk-ant-should-not-leak)'), {
        status: 404,
        type: 'not_found_error',
      }),
      'anthropic',
      'op',
    );
    expect(modelNotFound).toBeInstanceOf(ModelNotAvailableError);
    expect(modelNotFound.message).not.toContain('sk-ant-should-not-leak');
  });

  it('maps a network failure to NetworkError, carrying the provider', () => {
    const error = toProviderError(withCode('socket hang up', 'ECONNRESET'), 'openai', 'op');
    expect(error).toBeInstanceOf(NetworkError);
    expect((error as NetworkError).provider).toBe('openai');
  });

  it('maps an SDK connection-error class to NetworkError', () => {
    const error = toProviderError(
      new ApiConnectionErrorShape('Connection error.'),
      'anthropic',
      'op',
    );
    expect(error).toBeInstanceOf(NetworkError);
  });

  it('still falls back to a generic ProviderError for anything else (e.g. 503)', () => {
    const error = toProviderError(
      Object.assign(new Error('busy'), { status: 503 }),
      'openai',
      'OpenAI chat failed',
    );
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).not.toBeInstanceOf(AuthenticationError);
    expect(error).not.toBeInstanceOf(NetworkError);
    expect(error).not.toBeInstanceOf(ModelNotAvailableError);
  });
});

describe('classifyProviderFailure', () => {
  const table: Array<[string, unknown, boolean, TProviderFailureReason]> = [
    ['529', httpError(529), true, 'overloaded'],
    [
      'overloaded_error with no status',
      new ProviderError('sse', 'anthropic', undefined, undefined, { type: 'overloaded_error' }),
      true,
      'overloaded',
    ],
    ['503', httpError(503), true, 'service-unavailable'],
    ['500', httpError(500), true, 'server-error'],
    ['502', httpError(502), true, 'server-error'],
    ['504', httpError(504), true, 'server-error'],
    ['404', httpError(404, 'not_found_error'), true, 'model-unavailable'],
    ['ModelNotAvailableError', new ModelNotAvailableError('m', 'p'), true, 'model-unavailable'],
    ['401', httpError(401), false, 'authentication'],
    ['403', httpError(403), false, 'authentication'],
    ['AuthenticationError', new AuthenticationError('bad key', 'openai'), false, 'authentication'],
    ['402', httpError(402), false, 'billing'],
    ['429', httpError(429), false, 'rate-limit'],
    ['RateLimitError', new RateLimitError('slow', undefined, 'openai'), false, 'rate-limit'],
    ['400', httpError(400), false, 'invalid-request'],
    ['413', httpError(413), false, 'invalid-request'],
    ['NetworkError', new NetworkError('down'), false, 'network'],
    ['ECONNRESET', withCode('socket hang up', 'ECONNRESET'), false, 'network'],
    ['fetch failed', new TypeError('fetch failed'), false, 'network'],
    [
      'wrapped ECONNRESET',
      new ProviderError('failed', 'openai', withCode('reset', 'ECONNRESET')),
      false,
      'network',
    ],
    ['AbortError', new DOMException('aborted', 'AbortError'), false, 'aborted'],
    [
      'wrapped AbortError',
      new ProviderError('failed', 'openai', new DOMException('aborted', 'AbortError')),
      false,
      'aborted',
    ],
    ['raw SDK 529', Object.assign(new Error('overloaded'), { status: 529 }), true, 'overloaded'],
    ['ProviderError without details', new ProviderError('odd', 'openai'), false, 'unknown'],
    ['plain Error', new Error('something'), false, 'unknown'],
    ['string', 'boom', false, 'unknown'],
    ['408', httpError(408), false, 'unknown'],
    ['SDK abort class', new APIUserAbortErrorShape('Request was aborted.'), false, 'aborted'],
    ['SDK connection class', new ApiConnectionErrorShape('Connection error.'), false, 'network'],
    [
      '400 with code model_not_found',
      Object.assign(withCode('The model does not exist', 'model_not_found'), {
        status: 400,
        type: 'invalid_request_error',
      }),
      true,
      'model-unavailable',
    ],
    [
      'wrapped 400 with code model_not_found',
      toProviderError(
        Object.assign(withCode('The model does not exist', 'model_not_found'), {
          status: 400,
          type: 'invalid_request_error',
        }),
        'deepseek',
        'op',
      ),
      true,
      'model-unavailable',
    ],
    [
      'wrapped ModelNotAvailableError',
      wrapped(new ModelNotAvailableError('m', 'p')),
      true,
      'model-unavailable',
    ],
    ['wrapped RateLimitError', wrapped(new RateLimitError('slow')), false, 'rate-limit'],
    [
      'wrapped AuthenticationError',
      wrapped(new AuthenticationError('bad key')),
      false,
      'authentication',
    ],
    [
      'outer 401 over inner model_not_found',
      new ProviderError('denied', 'deepseek', modelNotFound(401), undefined, { status: 401 }),
      false,
      'authentication',
    ],
    [
      'outer 429 over inner model_not_found',
      new ProviderError('slow', 'deepseek', modelNotFound(429), undefined, { status: 429 }),
      false,
      'rate-limit',
    ],
    [
      'RateLimitError over a model_not_found cause',
      Object.assign(new RateLimitError('slow'), { cause: modelNotFound(400) }),
      false,
      'rate-limit',
    ],
    [
      'AuthenticationError over a model_not_found cause',
      Object.assign(new AuthenticationError('bad key'), { cause: modelNotFound(400) }),
      false,
      'authentication',
    ],
    ['single 401 with code model_not_found', modelNotFound(401), false, 'authentication'],
    ['single 429 with code model_not_found', modelNotFound(429), false, 'rate-limit'],
    ['NetworkError over an inner 503', new NetworkError('down', httpError(503)), false, 'network'],
    [
      'ECONNRESET over a 503 cause',
      Object.assign(withCode('socket hang up', 'ECONNRESET'), { cause: httpError(503) }),
      false,
      'network',
    ],
    [
      'SDK connection class over a 503 cause, wrapped',
      toProviderError(
        new ApiConnectionErrorShape('Connection error.', { cause: httpError(503) }),
        'openai',
        'op',
      ),
      false,
      'network',
    ],
    [
      'outer 400 refined by an inner model_not_found code',
      new ProviderError('bad', 'deepseek', modelNotFound(400), undefined, { status: 400 }),
      true,
      'model-unavailable',
    ],
    [
      'outer 400 over an AuthenticationError over model_not_found',
      new ProviderError(
        'bad',
        'deepseek',
        Object.assign(new AuthenticationError('bad key'), { cause: modelNotFound(400) }),
        undefined,
        { status: 400 },
      ),
      false,
      'invalid-request',
    ],
    [
      'outer 400 over a RateLimitError over model_not_found',
      new ProviderError(
        'bad',
        'deepseek',
        Object.assign(new RateLimitError('slow'), { cause: modelNotFound(400) }),
        undefined,
        { status: 400 },
      ),
      false,
      'invalid-request',
    ],
    [
      'outer 400 over a NetworkError over model_not_found',
      new ProviderError(
        'bad',
        'deepseek',
        new NetworkError('down', modelNotFound(400)),
        undefined,
        { status: 400 },
      ),
      false,
      'invalid-request',
    ],
    [
      'outer 400 over a 401 over model_not_found',
      new ProviderError(
        'bad',
        'deepseek',
        new ProviderError('denied', 'deepseek', modelNotFound(400), undefined, { status: 401 }),
        undefined,
        { status: 400 },
      ),
      false,
      'invalid-request',
    ],
  ];

  it.each(table)('%s', (_label, error, switchable, reason) => {
    expect(classifyProviderFailure(error)).toEqual({ switchable, reason });
  });

  it('reads through every wrapped layer, including a cause under an originalError', () => {
    const connection = new ApiConnectionErrorShape('Connection error.', {
      cause: new TypeError('fetch failed'),
    });
    expect(classifyProviderFailure(toProviderError(connection, 'openai', 'op'))).toEqual({
      switchable: false,
      reason: 'network',
    });
    const deep = new ProviderError(
      'outer',
      'conversation',
      new ProviderError(
        'inner',
        'openai',
        new Error('x', { cause: new TypeError('fetch failed') }),
      ),
    );
    expect(classifyProviderFailure(deep)).toEqual({ switchable: false, reason: 'network' });
  });

  it('stops on a wrap cycle', () => {
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    (a as Error & { cause?: unknown }).cause = b;
    expect(classifyProviderFailure(a)).toEqual({ switchable: false, reason: 'unknown' });
  });

  it('treats any failure after the caller aborted as an abort', () => {
    const controller = new AbortController();
    controller.abort();
    expect(classifyProviderFailure(httpError(529), controller.signal)).toEqual({
      switchable: false,
      reason: 'aborted',
    });
  });
});
