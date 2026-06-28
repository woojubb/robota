import { describe, it, expect } from 'vitest';

import { ReplayProvider } from '../replay-provider.js';

import type { ISessionLogLine } from '@robota-sdk/agent-session';

interface IRecordedToolCall {
  id: string;
  function: { name: string; arguments: string };
}

function line(event: string, data: Record<string, unknown>): ISessionLogLine {
  return { timestamp: '2026-06-28T00:00:00.000Z', sessionId: 's1', event, ...data };
}

describe('ReplayProvider (INFRA-017)', () => {
  it('TC-03: replays recorded normalized responses in order, then errors when exhausted', async () => {
    const entries: ISessionLogLine[] = [
      line('provider_request', { executionId: 'e1', round: 0 }),
      line('provider_response_normalized', {
        executionId: 'e1',
        round: 0,
        response: {
          role: 'assistant',
          content: 'Hi!',
          id: 'a1',
          timestamp: '2026-06-28T00:00:01.000Z',
        },
      }),
    ];
    const provider = new ReplayProvider({ entries });

    expect(provider.recordedResponseCount).toBe(1);
    const res = await provider.chat([]);
    expect(res.role).toBe('assistant');
    expect(res.content).toBe('Hi!');
    expect(res.timestamp).toBeInstanceOf(Date);
    await expect(provider.chat([])).rejects.toThrow(/exhausted/);
  });

  it('TC-04: replays a tool-call turn, then the final completion', async () => {
    const entries: ISessionLogLine[] = [
      line('provider_response_normalized', {
        executionId: 'e1',
        round: 0,
        response: {
          role: 'assistant',
          content: '',
          id: 'a1',
          timestamp: '2026-06-28T00:00:01.000Z',
          toolCalls: [{ id: 't1', function: { name: 'Read', arguments: '{}' } }],
        },
      }),
      line('provider_response_normalized', {
        executionId: 'e1',
        round: 1,
        response: {
          role: 'assistant',
          content: 'Done.',
          id: 'a2',
          timestamp: '2026-06-28T00:00:02.000Z',
        },
      }),
    ];
    const provider = new ReplayProvider({ entries });

    const first = await provider.chat([]);
    const toolCalls = (first as { toolCalls?: IRecordedToolCall[] }).toolCalls;
    expect(toolCalls?.[0]?.function.name).toBe('Read');

    const second = await provider.chat([]);
    expect(second.content).toBe('Done.');
  });

  it('ignores non-replay-substrate events (observability/text_delta/user)', () => {
    const entries: ISessionLogLine[] = [
      line('text_delta', { delta: 'x' }),
      line('user', { content: 'hi' }),
      line('assistant', { content: 'observability-only' }),
    ];
    expect(new ReplayProvider({ entries }).recordedResponseCount).toBe(0);
  });

  it('chatStream yields the recorded response', async () => {
    const entries: ISessionLogLine[] = [
      line('provider_response_normalized', {
        executionId: 'e1',
        round: 0,
        response: {
          role: 'assistant',
          content: 'streamed',
          id: 'a1',
          timestamp: '2026-06-28T00:00:01.000Z',
        },
      }),
    ];
    const provider = new ReplayProvider({ entries });
    const chunks = [];
    for await (const chunk of provider.chatStream([])) chunks.push(chunk);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.content).toBe('streamed');
  });
});
