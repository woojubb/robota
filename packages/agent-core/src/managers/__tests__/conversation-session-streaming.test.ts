import { describe, it, expect } from 'vitest';
import { ConversationSession } from '../conversation-session.js';
import type { IAssistantMessage } from '../../interfaces/messages.js';

describe('ConversationSession streaming state', () => {
  it('appendStreaming accumulates text', () => {
    const session = new ConversationSession();
    session.appendStreaming('Hello');
    session.appendStreaming(' world');
    session.commitAssistant('complete');
    const msgs = session.getMessages();
    const last = msgs[msgs.length - 1];
    expect(last.role).toBe('assistant');
    expect(last.content).toBe('Hello world');
    expect(last.state).toBe('complete');
    expect(last.id).toBeDefined();
  });

  it('commitAssistant with interrupted state', () => {
    const session = new ConversationSession();
    session.appendStreaming('Partial');
    session.commitAssistant('interrupted');
    const msgs = session.getMessages();
    const last = msgs[msgs.length - 1];
    expect(last.state).toBe('interrupted');
    expect(last.content).toBe('Partial');
  });

  it('commitAssistant strips text when tool calls present', () => {
    const session = new ConversationSession();
    session.appendStreaming('Some text');
    session.appendToolCall({
      id: 'tc1',
      type: 'function',
      function: { name: 'Read', arguments: '{}' },
    });
    session.commitAssistant('complete');
    const msgs = session.getMessages();
    const last = msgs[msgs.length - 1] as IAssistantMessage;
    expect(last.content).toBe('');
    expect(last.toolCalls).toHaveLength(1);
  });

  it('appendToolCall deduplicates by id', () => {
    const session = new ConversationSession();
    const tc = {
      id: 'tc1',
      type: 'function' as const,
      function: { name: 'Read', arguments: '{}' },
    };
    session.appendToolCall(tc);
    session.appendToolCall(tc);
    session.commitAssistant('complete');
    const msgs = session.getMessages();
    const last = msgs[msgs.length - 1] as IAssistantMessage;
    expect(last.toolCalls).toHaveLength(1);
  });

  it('commitAssistant is no-op when no pending state', () => {
    const session = new ConversationSession();
    session.addUserMessage('test');
    const before = session.getMessageCount();
    session.commitAssistant('complete');
    expect(session.getMessageCount()).toBe(before);
  });

  it('discardPending clears without saving', () => {
    const session = new ConversationSession();
    session.appendStreaming('discard this');
    session.discardPending();
    session.commitAssistant('complete');
    expect(session.getMessageCount()).toBe(0);
  });

  it('commitAssistant passes metadata', () => {
    const session = new ConversationSession();
    session.appendStreaming('text');
    session.commitAssistant('complete', { round: 1, inputTokens: 100 });
    const msgs = session.getMessages();
    const last = msgs[msgs.length - 1];
    expect(last.metadata).toEqual({ round: 1, inputTokens: 100 });
  });
});
