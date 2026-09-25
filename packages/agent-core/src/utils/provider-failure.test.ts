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
