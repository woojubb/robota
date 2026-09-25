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
  ];

  it.each(table)('%s', (_label, error, switchable, reason) => {
    expect(classifyProviderFailure(error)).toEqual({ switchable, reason });
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
