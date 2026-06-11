/**
 * Tests for buildFinalResult provider-error marking (CLI-064).
 *
 * The provider-error round branch records the failure as an assistant message with
 * `providerError: true` metadata. buildFinalResult must not count that message as a
 * successful response — robotaRun's failed-result throw depends on `success`/`error`.
 */

import { describe, expect, it } from 'vitest';

import { ConversationStore } from '../managers/conversation-history-manager';

import { buildFinalResult } from './execution-service-helpers';

describe('buildFinalResult provider-error marking (CLI-064)', () => {
  it('TC-01: marks the result failed when the final assistant message is a provider error', () => {
    const store = new ConversationStore();
    store.addUserMessage('say hi');
    store.addAssistantMessage('Request failed: 401 authentication_error', [], {
      round: 1,
      providerError: true,
    });

    const result = buildFinalResult(store, 'exec-1', new Date(), []);

    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error?.message).toContain('Request failed: 401');
    // History append-only: exactly one provider-error assistant message, untouched.
    const assistantMessages = store.getMessages().filter((message) => message.role === 'assistant');
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]?.content).toContain('Request failed: 401');
  });

  it('TC-01: a normal assistant response stays successful', () => {
    const store = new ConversationStore();
    store.addUserMessage('say hi');
    store.addAssistantMessage('hello!', [], { round: 1 });

    const result = buildFinalResult(store, 'exec-2', new Date(), []);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.response).toBe('hello!');
  });

  it('TC-01: a provider error in an earlier round does not fail a later successful response', () => {
    const store = new ConversationStore();
    store.addUserMessage('say hi');
    store.addAssistantMessage('Request failed: 500 overloaded', [], {
      round: 1,
      providerError: true,
    });
    store.addUserMessage('retry please');
    store.addAssistantMessage('hello after retry!', [], { round: 2 });

    const result = buildFinalResult(store, 'exec-3', new Date(), []);

    expect(result.success).toBe(true);
    expect(result.response).toBe('hello after retry!');
  });
});
