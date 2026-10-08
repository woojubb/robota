import { describe, expect, it } from 'vitest';

import { createAssistantMessage, createToolMessage, createUserMessage } from '@robota-sdk/agent-core';

import { reconcileInterruptedCalls } from '../interactive-session-restore.js';

const call = (id: string) => ({ id, type: 'function' as const, function: { name: 'Shell', arguments: '{"command":"echo once"}' } });

describe('interrupted tool-call restoration', () => {
  it('pairs the original call with an unknown-outcome receipt without replaying or changing IDs', () => {
    const user = createUserMessage('run once');
    const assistant = createAssistantMessage(null, { toolCalls: [call('call-original')] });
    const restored = reconcileInterruptedCalls([user, assistant]);

    expect(restored.messages[0]).toBe(user);
    expect(restored.messages[1]).toBe(assistant);
    expect(restored.interruptedCalls).toEqual([{ id: 'call-original', name: 'Shell' }]);
    expect(restored.messages[2]).toMatchObject({
      role: 'tool', toolCallId: 'call-original', state: 'interrupted',
      metadata: { interrupted: true, outcome: 'unknown' },
    });
    expect(restored.messages[2]?.content).toContain('Do not retry automatically');
    expect(reconcileInterruptedCalls(restored.messages).interruptedCalls).toEqual([]);
  });

  it('only repairs missing receipts and inserts them before the next user turn', () => {
    const assistant = createAssistantMessage(null, { toolCalls: [call('one'), call('two')] });
    const completed = createToolMessage('done', { toolCallId: 'two', name: 'Shell' });
    const next = createUserMessage('next');
    const restored = reconcileInterruptedCalls([assistant, completed, next]);

    expect(restored.messages.map((message) => message.role)).toEqual(['assistant', 'tool', 'tool', 'user']);
    expect(restored.messages[1]).toBe(completed);
    expect(restored.messages[2]).toMatchObject({ role: 'tool', toolCallId: 'one' });
    expect(restored.messages[3]).toBe(next);
  });
});
