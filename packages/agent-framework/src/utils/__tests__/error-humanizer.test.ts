import {
  AuthenticationError,
  ModelNotAvailableError,
  NetworkError,
  ProviderError,
  RateLimitError,
} from '@robota-sdk/agent-core';
import { describe, expect, it } from 'vitest';

import { humanizeApiError } from '../error-humanizer';

/**
 * #3275/#3289 §3: since built-in providers now throw the typed errors below (agent-core's
 * `toProviderError`), the `instanceof` branches here are the path actually taken in practice — not
 * just the HTTP-pattern regex fallback that used to be the only thing exercised.
 */
describe('humanizeApiError', () => {
  it('reports an authentication failure in plain words, with the product-owned hint', () => {
    const message = humanizeApiError(new AuthenticationError('invalid x-api-key', 'anthropic'), {
      authentication: 'Run `/provider` to reconfigure.',
    });
    expect(message).toBe('Invalid API key. Run `/provider` to reconfigure.');
  });

  it('reports a rate limit, naming the wait when the provider gave one', () => {
    expect(humanizeApiError(new RateLimitError('slow down', 30, 'openai'))).toBe(
      'Rate limit reached (retry after 30s). Wait a moment and try again.',
    );
    expect(humanizeApiError(new RateLimitError('slow down', undefined, 'openai'))).toBe(
      'Rate limit reached. Wait a moment and try again.',
    );
  });

  it('reports a network failure in plain words', () => {
    expect(humanizeApiError(new NetworkError('ECONNREFUSED'))).toBe(
      'Network connection failed. Check your internet connection.',
    );
  });

  it('reports a model-not-available failure naming the model and provider', () => {
    const message = humanizeApiError(new ModelNotAvailableError('claude-x', 'anthropic'), {
      modelUnavailable: 'Run `/provider` to pick a model this key can use.',
    });
    expect(message).toBe(
      'The model "claude-x" is not available for anthropic. Run `/provider` to pick a model this key can use.',
    );
  });

  it('reports a model-not-available failure with no model name, when the classifier could not tell', () => {
    expect(humanizeApiError(new ModelNotAvailableError(undefined, 'anthropic'))).toBe(
      'The model is not available for anthropic.',
    );
  });

  it('recurses into a ProviderError wrapping a typed failure', () => {
    const wrapped = new ProviderError(
      'Conversation failed',
      'conversation',
      new AuthenticationError('bad key', 'openai'),
    );
    expect(humanizeApiError(wrapped)).toBe('Invalid API key.');
  });

  it('falls back to pattern-matching a raw message when the error is not in the taxonomy', () => {
    expect(humanizeApiError(new Error('Request failed with status code 401'))).toBe(
      'Invalid API key.',
    );
    expect(humanizeApiError(new Error('ECONNREFUSED 127.0.0.1:443'))).toBe(
      'Network connection failed. Check your internet connection.',
    );
  });

  it('returns the original message when nothing recognizes it', () => {
    expect(humanizeApiError(new Error('a completely unrelated failure'))).toBe(
      'a completely unrelated failure',
    );
  });
});
