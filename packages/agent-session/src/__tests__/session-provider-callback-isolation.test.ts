import { describe, expect, it, vi } from 'vitest';
import { EventHistoryModule, PROVIDER_CALL_EVENTS } from '@robota-sdk/agent-core';
import type { IAIProvider, IChatOptions, TUniversalMessage } from '@robota-sdk/agent-core';
import { Session } from '../session.js';

function createSharedProvider(): IAIProvider & {
  onTextDelta?: (delta: string) => void;
} {
  return {
    name: 'mock-provider',
    version: '1.0.0',
    onTextDelta: undefined,
    chat: vi.fn(
      async (
        _messages: TUniversalMessage[],
        options?: IChatOptions,
      ): Promise<TUniversalMessage> => {
        options?.onTextDelta?.('streamed text');
        return {
          id: 'assistant_1',
          role: 'assistant',
          content: 'final text',
          timestamp: new Date(),
          state: 'complete',
        };
      },
    ),
    generateResponse: vi.fn(),
    supportsTools: () => true,
    validateConfig: () => true,
  };
}

function createTerminal() {
  return {
    write: vi.fn(),
    writeLine: vi.fn(),
    writeMarkdown: vi.fn(),
    writeError: vi.fn(),
    prompt: vi.fn(),
    select: vi.fn(),
    spinner: vi.fn().mockReturnValue({ stop: vi.fn(), update: vi.fn() }),
  };
}

function createSession(provider: IAIProvider, onTextDelta: (delta: string) => void): Session {
  return new Session({
    cwd: process.cwd(),
    tools: [],
    provider,
    systemMessage: 'test system',
    terminal: createTerminal(),
    model: 'test-model',
    onTextDelta,
  });
}

describe('Session provider callback isolation', () => {
  it('publishes one content-free provider lifecycle through the real session event bus', async () => {
    const provider = createSharedProvider();
    const session = createSession(provider, () => {});
    const observations: Record<string, unknown>[] = [];
    const append = vi.fn();
    const history = new EventHistoryModule(
      { append, read: () => [] } as never,
      session.getEventService(),
    );
    session.getEventService().subscribe((event, data) => {
      if (event === PROVIDER_CALL_EVENTS.COMPLETED) observations.push(data);
    });

    try {
      await expect(session.run('private prompt')).resolves.toEqual(expect.any(String));
    } finally {
      history.detach(session.getEventService());
    }

    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({ round: 1, outcome: 'success' });
    expect(new Date(observations[0]!['startedAt'] as string).getTime()).toBeLessThanOrEqual(
      new Date(observations[0]!['endedAt'] as string).getTime(),
    );
    expect(JSON.stringify(observations)).not.toMatch(/private prompt|final text|streamed text/);
    expect(append).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: PROVIDER_CALL_EVENTS.COMPLETED,
        context: expect.objectContaining({
          ownerPath: [expect.objectContaining({ type: 'session' })],
        }),
      }),
    );
  });

  it('keeps onTextDelta isolated when sessions share a provider instance', async () => {
    const provider = createSharedProvider();
    const parentDeltas: string[] = [];
    const childDeltas: string[] = [];

    const parentSession = createSession(provider, (delta) => parentDeltas.push(delta));
    createSession(provider, (delta) => childDeltas.push(delta));

    expect(provider.onTextDelta).toBeUndefined();

    await parentSession.run('parent prompt');

    expect(parentDeltas).toEqual(['streamed text']);
    expect(childDeltas).toEqual([]);
  });

  it('emits context updates before provider response and after usage reconciliation', async () => {
    const snapshots: Array<{ usedTokens: number; usedPercentage: number }> = [];
    const provider = createSharedProvider();
    provider.chat = vi.fn(async (): Promise<TUniversalMessage> => {
      expect(snapshots.length).toBeGreaterThan(0);
      return {
        id: 'assistant_1',
        role: 'assistant',
        content: 'final text',
        timestamp: new Date(),
        state: 'complete',
        metadata: { inputTokens: 10, outputTokens: 5 },
      };
    });
    const session = new Session({
      cwd: process.cwd(),
      tools: [],
      provider,
      systemMessage: 'test system',
      terminal: createTerminal(),
      model: 'test-model',
      onContextUpdate: (state) =>
        snapshots.push({ usedTokens: state.usedTokens, usedPercentage: state.usedPercentage }),
    });

    await session.run('parent prompt');

    expect(snapshots.length).toBeGreaterThanOrEqual(2);
    expect(snapshots[0]?.usedTokens).toBeGreaterThan(0);
    // usedTokens reflects serialized JSON estimate of the conversation, not provider-reported tokens.
    expect(snapshots.at(-1)?.usedTokens).toBeGreaterThan(0);
  });
});
