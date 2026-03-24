import { describe, it, expect } from 'vitest';
import { ConversationStore } from '../conversation-store.js';
import { isAssistantMessage } from '../../interfaces/messages.js';
import {
  createUserMessage,
  createAssistantMessage,
  createSystemMessage,
  createToolMessage,
} from '../conversation-message-factory.js';
import type { IAssistantMessage } from '../../interfaces/messages.js';

describe('ConversationStore streaming state', () => {
  it('appendStreaming accumulates text', () => {
    const session = new ConversationStore();
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
    const session = new ConversationStore();
    session.appendStreaming('Partial');
    session.commitAssistant('interrupted');
    const msgs = session.getMessages();
    const last = msgs[msgs.length - 1];
    expect(last.state).toBe('interrupted');
    expect(last.content).toBe('Partial');
  });

  it('commitAssistant strips text when tool calls present', () => {
    const session = new ConversationStore();
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
    const session = new ConversationStore();
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
    const session = new ConversationStore();
    session.addUserMessage('test');
    const before = session.getMessageCount();
    session.commitAssistant('complete');
    expect(session.getMessageCount()).toBe(before);
  });

  it('discardPending clears without saving', () => {
    const session = new ConversationStore();
    session.appendStreaming('discard this');
    session.discardPending();
    session.commitAssistant('complete');
    expect(session.getMessageCount()).toBe(0);
  });

  it('commitAssistant passes metadata', () => {
    const session = new ConversationStore();
    session.appendStreaming('text');
    session.commitAssistant('complete', { round: 1, inputTokens: 100 });
    const msgs = session.getMessages();
    const last = msgs[msgs.length - 1];
    expect(last.metadata).toEqual({ round: 1, inputTokens: 100 });
  });

  it('committed message has unique id', () => {
    const session = new ConversationStore();
    session.appendStreaming('first');
    session.commitAssistant('complete');
    session.appendStreaming('second');
    session.commitAssistant('complete');
    const msgs = session.getMessages();
    expect(msgs[0].id).not.toBe(msgs[1].id);
    expect(msgs[0].id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('hasPendingAssistant returns correct state', () => {
    const session = new ConversationStore();
    expect(session.hasPendingAssistant()).toBe(false);
    session.appendStreaming('text');
    expect(session.hasPendingAssistant()).toBe(true);
    session.commitAssistant('complete');
    expect(session.hasPendingAssistant()).toBe(false);
  });
});

describe('ConversationStore getMessagesForAPI', () => {
  it('annotates interrupted assistant messages with suffix', () => {
    const session = new ConversationStore();
    session.appendStreaming('Partial response here');
    session.commitAssistant('interrupted');
    const api = session.getMessagesForAPI();
    expect(api).toHaveLength(1);
    expect(api[0].content).toContain('Partial response here');
    expect(api[0].content).toContain('[This response was interrupted by the user]');
  });

  it('does not annotate complete assistant messages', () => {
    const session = new ConversationStore();
    session.appendStreaming('Full response');
    session.commitAssistant('complete');
    const api = session.getMessagesForAPI();
    expect(api[0].content).toBe('Full response');
    expect(api[0].content).not.toContain('[This response was interrupted');
  });

  it('does not annotate non-assistant messages even if interrupted', () => {
    const session = new ConversationStore();
    session.addUserMessage('hello');
    const api = session.getMessagesForAPI();
    expect(api[0].content).toBe('hello');
    expect(api[0].content).not.toContain('[This response was interrupted');
  });

  it('preserves tool_calls in API format', () => {
    const session = new ConversationStore();
    session.appendToolCall({
      id: 'tc1',
      type: 'function',
      function: { name: 'Read', arguments: '{"path":"/tmp"}' },
    });
    session.commitAssistant('complete');
    const api = session.getMessagesForAPI();
    expect(api[0].tool_calls).toHaveLength(1);
    expect(api[0].tool_calls![0].function.name).toBe('Read');
  });
});

describe('Message factories generate id and state', () => {
  it('createUserMessage has id and state', () => {
    const msg = createUserMessage('hello');
    expect(msg.id).toBeDefined();
    expect(msg.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(msg.state).toBe('complete');
  });

  it('createAssistantMessage defaults to complete', () => {
    const msg = createAssistantMessage('response');
    expect(msg.state).toBe('complete');
    expect(msg.id).toBeDefined();
  });

  it('createAssistantMessage accepts interrupted state', () => {
    const msg = createAssistantMessage('partial', { state: 'interrupted' });
    expect(msg.state).toBe('interrupted');
  });

  it('createSystemMessage has id and state', () => {
    const msg = createSystemMessage('system');
    expect(msg.id).toBeDefined();
    expect(msg.state).toBe('complete');
  });

  it('createToolMessage has id and state', () => {
    const msg = createToolMessage('result', { toolCallId: 'tc1' });
    expect(msg.id).toBeDefined();
    expect(msg.state).toBe('complete');
  });

  it('each factory call generates unique id', () => {
    const a = createUserMessage('a');
    const b = createUserMessage('b');
    expect(a.id).not.toBe(b.id);
  });
});
