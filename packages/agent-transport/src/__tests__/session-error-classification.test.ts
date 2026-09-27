import {
  AuthenticationError,
  ModelNotAvailableError,
  NetworkError,
  ProviderError,
  RateLimitError,
} from '@robota-sdk/agent-core';
import { describe, expect, it, vi } from 'vitest';

import { createOutboundDelivery } from '../outbound-delivery.js';
import { classifySessionErrorForWire } from '../session-error-classification.js';
import { subscribeSessionEvents } from '../session-events.js';

import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';

/**
 * #3289 §3: the `error` wire frame gains a typed `code`/`provider`/`retryAfterSeconds` alongside the
 * raw `message`, so a renderer can say what happened in plain words instead of showing the vendor's
 * raw text. Additive — an error this classification does not recognize carries no `code` at all,
 * which is exactly today's behavior (unchanged).
 */
describe('classifySessionErrorForWire', () => {
  it('classifies an AuthenticationError', () => {
    expect(classifySessionErrorForWire(new AuthenticationError('bad key', 'anthropic'))).toEqual({
      code: 'auth',
      provider: 'anthropic',
    });
  });

  it('classifies a RateLimitError, carrying retryAfterSeconds when the provider gave one', () => {
    expect(
      classifySessionErrorForWire(new RateLimitError('slow down', 30, 'openai')),
    ).toEqual({ code: 'rate_limit', provider: 'openai', retryAfterSeconds: 30 });
    expect(classifySessionErrorForWire(new RateLimitError('slow down', undefined, 'openai'))).toEqual(
      { code: 'rate_limit', provider: 'openai' },
    );
  });

  it('classifies a ModelNotAvailableError', () => {
    expect(
      classifySessionErrorForWire(new ModelNotAvailableError('claude-x', 'anthropic')),
    ).toEqual({ code: 'model_unavailable', provider: 'anthropic' });
  });

  it('classifies a NetworkError, carrying the provider when the failure named one', () => {
    expect(classifySessionErrorForWire(new NetworkError('down', undefined, 'anthropic'))).toEqual({
      code: 'network',
      provider: 'anthropic',
    });
    expect(classifySessionErrorForWire(new NetworkError('down'))).toEqual({ code: 'network' });
  });

  it('classifies a generic ProviderError as the fallback "provider" code', () => {
    expect(classifySessionErrorForWire(new ProviderError('failed', 'gemini'))).toEqual({
      code: 'provider',
      provider: 'gemini',
    });
  });

  it('classifies through a wrapping layer (e.g. a higher-level "Conversation failed")', () => {
    const wrapped = new ProviderError(
      'Conversation failed',
      'conversation',
      new AuthenticationError('bad key', 'openai'),
    );
    expect(classifySessionErrorForWire(wrapped)).toEqual({ code: 'auth', provider: 'openai' });
  });

  it('leaves an unrelated error uncoded, so the caller keeps showing its raw message unchanged', () => {
    expect(classifySessionErrorForWire(new Error('some internal failure'))).toEqual({});
  });
});

describe('the error wire frame carries the classification (#3289 §3)', () => {
  it('adds code/provider/retryAfterSeconds onto the delivered error frame', () => {
    const send = vi.fn();
    const session = createTestInteractiveSession({ on: vi.fn(), off: vi.fn() });
    subscribeSessionEvents(session, createOutboundDelivery(send, vi.fn()));

    const onError = vi.mocked(session.on).mock.calls.find(([name]) => name === 'error')?.[1] as (
      error: Error,
    ) => void;
    onError(new RateLimitError('slow down', 12, 'anthropic'));

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        message: 'Rate Limit Error: slow down',
        code: 'rate_limit',
        provider: 'anthropic',
        retryAfterSeconds: 12,
      }),
    );
  });

  it('delivers an unrelated error with no code, exactly as before', () => {
    const send = vi.fn();
    const session = createTestInteractiveSession({ on: vi.fn(), off: vi.fn() });
    subscribeSessionEvents(session, createOutboundDelivery(send, vi.fn()));

    const onError = vi.mocked(session.on).mock.calls.find(([name]) => name === 'error')?.[1] as (
      error: Error,
    ) => void;
    onError(new Error('boom'));

    expect(send).toHaveBeenCalledWith({ type: 'error', message: 'boom' });
  });
});
