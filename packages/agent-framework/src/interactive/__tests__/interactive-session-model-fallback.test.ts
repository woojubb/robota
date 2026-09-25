/**
 * A turn that moved to another model says so where the user reads the turn, and its usage is
 * attributed to the model that answered, not the one the session was started on.
 */

import { describe, expect, it, vi } from 'vitest';

import { InteractiveSession } from '../interactive-session.js';

import type { IUsageObservation } from '@robota-sdk/agent-interface-analytics';

function createMockSession(options?: {
  runResult?: string;
  runError?: Error;
  runDelay?: number;
  history?: Array<{ role: string; content?: string; state?: string; toolCalls?: unknown[] }>;
}) {
  const history = options?.history ?? [];
  return {
    run: vi.fn().mockImplementation(async (_prompt: string) => {
      if (options?.runDelay) {
        await new Promise((r) => setTimeout(r, options.runDelay));
      }
      if (options?.runError) throw options.runError;
      return options?.runResult ?? 'mock response';
    }),
    abort: vi.fn(),
    getHistory: vi.fn().mockReturnValue(history),
    getContextState: vi.fn().mockReturnValue({
      usedPercentage: 10,
      usedTokens: 1000,
      maxTokens: 200000,
    }),
    clearHistory: vi.fn(),
    getPermissionMode: vi.fn().mockReturnValue('default'),
    setPermissionMode: vi.fn(),
    getProviderId: vi.fn().mockReturnValue('test-provider'),
    getModelId: vi.fn().mockReturnValue('test-model'),
    getEventService: vi.fn().mockReturnValue({ subscribe: vi.fn(), unsubscribe: vi.fn() }),
    getSessionId: vi.fn().mockReturnValue('sess-1'),
    getSystemMessage: vi.fn().mockReturnValue('system prompt with capabilities'),
    getToolSchemas: vi
      .fn()
      .mockReturnValue([
        { name: 'Read', description: 'Read files', parameters: { type: 'object', properties: {} } },
      ]),
    getMessageCount: vi.fn().mockReturnValue(0),
    getSessionAllowedTools: vi.fn().mockReturnValue([]),
    compact: vi.fn(),
    injectMessage: vi.fn(),
    injectRawMessage: vi.fn(),
    syncContextFromHistory: vi.fn(),
  };
}

describe('a turn that moved to another model', () => {
  it('shows a system note and reports usage against the model that answered', async () => {
    const mockSession = createMockSession({ runResult: 'answer' });
    let listener: ((event: string, data: Record<string, unknown>) => void) | undefined;
    mockSession.getEventService.mockReturnValue({
      subscribe: vi.fn((callback: (event: string, data: Record<string, unknown>) => void) => {
        listener = callback;
      }),
      unsubscribe: vi.fn(),
    });
    mockSession.run.mockImplementation(async () => {
      const at = new Date().toISOString();
      listener?.('provider_fallback', {
        timestamp: new Date(),
        fromProvider: 'test-provider',
        fromModel: 'test-model',
        toProvider: 'openai',
        toModel: 'gpt-next',
        reason: 'overloaded',
      });
      listener?.('provider_call_completed', {
        timestamp: new Date(),
        startedAt: at,
        endedAt: at,
        outcome: 'success',
        round: 1,
        callId: '123e4567-e89b-42d3-a456-426614174000',
        disposition: 'invoked',
        providerId: 'openai',
        modelId: 'gpt-next',
        usageProvenance: 'absent',
      });
      return 'answer';
    });
    const session = new InteractiveSession({ session: mockSession as never, cwd: '/tmp' });

    await session.submit('question');

    const messages = session.getMessages();
    const noteIndex = messages.findIndex(
      (message) =>
        message.role === 'system' &&
        message.content === 'test-model was overloaded; this turn continued on gpt-next (openai).',
    );
    expect(noteIndex).toBeGreaterThan(-1);
    expect(messages.findIndex((message) => message.role === 'assistant')).toBeGreaterThan(
      noteIndex,
    );
    const observation = session.getFullHistory().find((entry) => entry.type === 'usage-observation')
      ?.data as IUsageObservation | undefined;
    expect(observation).toMatchObject({ providerId: 'openai', modelId: 'gpt-next' });
  });

  it('charges each model only the rounds it answered when the turn moved mid-way', async () => {
    const mockSession = createMockSession({ runResult: 'answer' });
    let listener: ((event: string, data: Record<string, unknown>) => void) | undefined;
    mockSession.getEventService.mockReturnValue({
      subscribe: vi.fn((callback: (event: string, data: Record<string, unknown>) => void) => {
        listener = callback;
      }),
      unsubscribe: vi.fn(),
    });
    const call = (
      round: number,
      callId: string,
      providerId: string,
      modelId: string,
      tokens: [number, number],
    ) => {
      const at = new Date().toISOString();
      listener?.('provider_call_completed', {
        timestamp: new Date(),
        startedAt: at,
        endedAt: at,
        outcome: 'success',
        round,
        callId,
        disposition: 'invoked',
        providerId,
        modelId,
        usageProvenance: 'complete',
        promptTokens: tokens[0],
        completionTokens: tokens[1],
        totalTokens: tokens[0] + tokens[1],
      });
    };
    mockSession.run.mockImplementation(async () => {
      call(1, '123e4567-e89b-42d3-a456-426614174001', 'test-provider', 'test-model', [100, 10]);
      call(2, '123e4567-e89b-42d3-a456-426614174002', 'openai', 'gpt-next', [300, 30]);
      return 'answer';
    });
    const session = new InteractiveSession({ session: mockSession as never, cwd: '/tmp' });

    await session.submit('question');

    const observation = session.getFullHistory().find((entry) => entry.type === 'usage-observation')
      ?.data as IUsageObservation | undefined;
    expect(observation?.modelId).toBeUndefined();
    expect(observation?.providerId).toBeUndefined();
    expect(observation?.modelShares).toEqual([
      expect.objectContaining({
        providerId: 'test-provider',
        modelId: 'test-model',
        promptTokens: 100,
        completionTokens: 10,
        totalTokens: 110,
      }),
      expect.objectContaining({
        providerId: 'openai',
        modelId: 'gpt-next',
        promptTokens: 300,
        completionTokens: 30,
        totalTokens: 330,
      }),
    ]);
  });
});
