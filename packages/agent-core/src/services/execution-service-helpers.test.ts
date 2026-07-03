/**
 * Tests for buildFinalResult provider-error marking (CLI-064).
 *
 * The provider-error round branch records the failure as an assistant message with
 * `providerError: true` metadata. buildFinalResult must not count that message as a
 * successful response — robotaRun's failed-result throw depends on `success`/`error`.
 */

import { describe, expect, it } from 'vitest';

import { ConversationStore } from '../managers/conversation-history-manager';

import {
  assertToolChoiceValid,
  buildFinalResult,
  initializeConversationStore,
  resolveToolChoiceForRound,
} from './execution-service-helpers';

import type { IAgentConfig } from '../interfaces/agent';
import type { TUniversalMessage } from '../interfaces/messages';

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

describe('initializeConversationStore restore robustness (CORE-008)', () => {
  const msg = (role: TUniversalMessage['role'], content: string): TUniversalMessage =>
    ({
      id: `${role}-${content}`,
      role,
      content,
      state: 'complete',
      timestamp: new Date(),
    }) as TUniversalMessage;

  it('restores conversation history even when a system prompt was pre-seeded before first run', () => {
    const store = new ConversationStore();
    // Simulate Robota.updateSystemPrompt('LIVE SYSTEM') before the first run: it sets config AND the
    // store head to the same value. A pre-seeded system head used to make the `getMessageCount() === 0`
    // restore guard false and silently drop the history (CORE-008).
    store.setSystemPrompt('LIVE SYSTEM');
    const conversationHistory = { getConversationStore: () => store };
    const messages: TUniversalMessage[] = [
      msg('user', 'previous question'),
      msg('assistant', 'previous answer'),
    ];
    const config = { systemMessage: 'LIVE SYSTEM' } as unknown as IAgentConfig;

    initializeConversationStore(conversationHistory, 'conv-1', messages, config, 'exec-1');

    const messagesByRole = (role: string): string[] =>
      store
        .getMessages()
        .filter((m) => m.role === role)
        .map((m) => String(m.content));
    // Restored user/assistant survive; the already-injected system head is reused (single message).
    expect(messagesByRole('user')).toEqual(['previous question']);
    expect(messagesByRole('assistant')).toEqual(['previous answer']);
    expect(messagesByRole('system')).toEqual(['LIVE SYSTEM']);
  });

  it('CORE-010: injects the system prompt once, then reuses the log (no re-attach across turns)', () => {
    const store = new ConversationStore();
    const conversationHistory = { getConversationStore: () => store };
    const config = { systemMessage: 'SYS' } as unknown as IAgentConfig;

    // Turn 1: empty log → inject the system prompt once.
    initializeConversationStore(conversationHistory, 'conv-3', [], config, 'exec-1');
    store.addUserMessage('turn 1');
    // Turn 2+: the log already has the system head → it is reused as-is, never re-attached.
    initializeConversationStore(conversationHistory, 'conv-3', [], config, 'exec-2');
    store.addUserMessage('turn 2');
    initializeConversationStore(conversationHistory, 'conv-3', [], config, 'exec-3');

    expect(
      store
        .getMessages()
        .filter((m) => m.role === 'system')
        .map((m) => String(m.content)),
    ).toEqual(['SYS']);
    expect(store.getMessages().map((m) => m.role)).toEqual(['system', 'user', 'user']);
  });

  it('CORE-009: on resume the live config.systemMessage replaces a differing persisted system prompt', () => {
    const store = new ConversationStore();
    const conversationHistory = { getConversationStore: () => store };
    // Persisted history that legitimately carried its own (stale) system prompt.
    const messages: TUniversalMessage[] = [
      msg('system', 'STALE persisted prompt'),
      msg('user', 'earlier turn'),
    ];
    const config = { systemMessage: 'FRESH live prompt' } as unknown as IAgentConfig;

    initializeConversationStore(conversationHistory, 'conv-2', messages, config, 'exec-2');

    const contentByRole = (role: string): string[] =>
      store
        .getMessages()
        .filter((m) => m.role === role)
        .map((m) => String(m.content));
    // Single head system = the fresh live prompt (staleness refresh); conversation preserved.
    expect(contentByRole('system')).toEqual(['FRESH live prompt']);
    expect(contentByRole('user')).toEqual(['earlier turn']);
  });
});

describe('assertToolChoiceValid (CORE-017)', () => {
  const tools = [
    {
      name: 'get_weather',
      description: 'w',
      parameters: { type: 'object' as const, properties: {} },
    },
  ];

  it('accepts unset/auto/none regardless of the tool list', () => {
    expect(() => assertToolChoiceValid(undefined, undefined)).not.toThrow();
    expect(() => assertToolChoiceValid('auto', undefined)).not.toThrow();
    expect(() => assertToolChoiceValid('none', undefined)).not.toThrow();
  });

  it("accepts 'required' and a known named tool when tools exist", () => {
    expect(() => assertToolChoiceValid('required', tools)).not.toThrow();
    expect(() => assertToolChoiceValid({ tool: 'get_weather' }, tools)).not.toThrow();
  });

  it("throws for 'required' with no tools", () => {
    expect(() => assertToolChoiceValid('required', [])).toThrow(/needs at least one tool/);
    expect(() => assertToolChoiceValid('required', undefined)).toThrow(/needs at least one tool/);
  });

  it('throws for a named tool missing from the list, naming the miss and the options', () => {
    expect(() => assertToolChoiceValid({ tool: 'nope' }, tools)).toThrow(/"nope"/);
    expect(() => assertToolChoiceValid({ tool: 'nope' }, tools)).toThrow(/get_weather/);
  });
});

describe('resolveToolChoiceForRound (CORE-017)', () => {
  it('passes everything through on round 1', () => {
    expect(resolveToolChoiceForRound('required', 1)).toBe('required');
    expect(resolveToolChoiceForRound({ tool: 'x' }, 1)).toEqual({ tool: 'x' });
    expect(resolveToolChoiceForRound('none', 1)).toBe('none');
  });

  it("reverts forcing directives to 'auto' after round 1 so the run can finish", () => {
    expect(resolveToolChoiceForRound('required', 2)).toBe('auto');
    expect(resolveToolChoiceForRound({ tool: 'x' }, 3)).toBe('auto');
  });

  it('persists auto/none/unset across rounds', () => {
    expect(resolveToolChoiceForRound('auto', 2)).toBe('auto');
    expect(resolveToolChoiceForRound('none', 2)).toBe('none');
    expect(resolveToolChoiceForRound(undefined, 2)).toBeUndefined();
  });
});
