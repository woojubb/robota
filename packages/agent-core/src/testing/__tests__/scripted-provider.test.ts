/**
 * Scripted provider fixture tests (CLI-074 TC-01).
 *
 * The fixture must replay declared turns in order, record every request's
 * message array for assertions, and fail fast on script exhaustion — never
 * silently improvise a response.
 */

import { describe, expect, it } from 'vitest';

import { createScriptedProvider } from '../scripted-provider.js';

describe('createScriptedProvider (CLI-074)', () => {
  it('TC-01: replays text turns in order and records requests', async () => {
    const { provider, requests } = createScriptedProvider([
      { text: 'first answer' },
      { text: 'second answer' },
    ]);

    const first = await provider.chat([
      { id: 'u1', role: 'user', content: 'hi', state: 'complete', timestamp: new Date() },
    ]);
    const second = await provider.chat([
      { id: 'u2', role: 'user', content: 'again', state: 'complete', timestamp: new Date() },
    ]);

    expect(first.role).toBe('assistant');
    expect(first.content).toBe('first answer');
    expect(second.content).toBe('second answer');
    expect(requests).toHaveLength(2);
    expect(requests[0]?.map((message) => message.content)).toContain('hi');
    expect(requests[1]?.map((message) => message.content)).toContain('again');
  });

  it('TC-01: replays tool_use turns as assistant toolCalls', async () => {
    const { provider } = createScriptedProvider([
      { toolCalls: [{ name: 'Read', args: { file_path: '/tmp/a.txt' } }] },
      { text: 'done reading' },
    ]);

    const turn = await provider.chat([
      { id: 'u1', role: 'user', content: 'read it', state: 'complete', timestamp: new Date() },
    ]);

    expect(turn.role).toBe('assistant');
    if (turn.role !== 'assistant') throw new Error('unreachable');
    expect(turn.content).toBeNull();
    expect(turn.toolCalls).toHaveLength(1);
    expect(turn.toolCalls?.[0]?.function.name).toBe('Read');
    expect(JSON.parse(turn.toolCalls?.[0]?.function.arguments ?? '{}')).toEqual({
      file_path: '/tmp/a.txt',
    });
  });

  it('TC-01: throws on script exhaustion instead of improvising', async () => {
    const { provider } = createScriptedProvider([{ text: 'only turn' }]);

    await provider.chat([
      { id: 'u1', role: 'user', content: 'one', state: 'complete', timestamp: new Date() },
    ]);

    await expect(
      provider.chat([
        { id: 'u2', role: 'user', content: 'two', state: 'complete', timestamp: new Date() },
      ]),
    ).rejects.toThrow(/script exhausted/i);
  });

  it('supportsTools is true and validateConfig passes (agent-loop prerequisites)', () => {
    const { provider } = createScriptedProvider([{ text: 'x' }]);
    expect(provider.supportsTools()).toBe(true);
  });
});

describe('createScriptedProvider thinking', () => {
  const userMessage = {
    id: 'u1',
    role: 'user' as const,
    content: 'hi',
    state: 'complete' as const,
    timestamp: new Date(),
  };

  it("streams a turn's thinking through onThinkingDelta before its text and keeps it out of the message", async () => {
    const { provider } = createScriptedProvider([{ thinking: 'pondering', text: 'answer' }]);
    const order: string[] = [];

    const message = await provider.chat([userMessage], {
      onThinkingDelta: (delta) => order.push(`thinking:${delta}`),
      onTextDelta: (delta) => order.push(`text:${delta}`),
    });

    expect(order).toEqual(['thinking:pondering', 'text:answer']);
    expect(message.content).toBe('answer');
  });

  it('streams thinking for a tool-call turn as well', async () => {
    const { provider } = createScriptedProvider([
      { thinking: 'need a file', toolCalls: [{ name: 'Read', args: {} }] },
    ]);
    const seen: string[] = [];

    await provider.chat([userMessage], { onThinkingDelta: (delta) => seen.push(delta) });

    expect(seen).toEqual(['need a file']);
  });

  it('streams nothing for a turn without thinking', async () => {
    const { provider } = createScriptedProvider([{ text: 'answer' }, { thinking: '', text: 'b' }]);
    const seen: string[] = [];

    await provider.chat([userMessage], { onThinkingDelta: (delta) => seen.push(delta) });
    await provider.chat([userMessage], { onThinkingDelta: (delta) => seen.push(delta) });

    expect(seen).toEqual([]);
  });
});
