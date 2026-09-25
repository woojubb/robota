/**
 * A request that moved to another model reaches the session's owner, so it can tell the user.
 */

import { describe, expect, it, vi } from 'vitest';
import { PROVIDER_FALLBACK_EVENTS } from '@robota-sdk/agent-core';

import { Session } from '../session.js';

import type { IAIProvider, IChatOptions, TUniversalMessage } from '@robota-sdk/agent-core';

describe('Session provider fallback', () => {
  it('publishes the move on the session event bus', async () => {
    const provider: IAIProvider = {
      name: 'anthropic',
      version: '1.0.0',
      chat: async (_messages: TUniversalMessage[], options?: IChatOptions) => {
        options?.onModelFallback?.({
          from: { provider: 'anthropic', model: 'test-model' },
          to: { provider: 'openai', model: 'gpt-next' },
          reason: 'overloaded',
        });
        return {
          id: 'assistant_1',
          role: 'assistant',
          content: 'answer',
          timestamp: new Date(),
          state: 'complete',
        };
      },
      generateResponse: vi.fn(),
      supportsTools: () => true,
      validateConfig: () => true,
    };
    const session = new Session({
      cwd: process.cwd(),
      tools: [],
      provider,
      systemMessage: 'test system',
      terminal: {
        write: vi.fn(),
        writeLine: vi.fn(),
        writeMarkdown: vi.fn(),
        writeError: vi.fn(),
        prompt: vi.fn(),
        select: vi.fn(),
        spinner: vi.fn().mockReturnValue({ stop: vi.fn(), update: vi.fn() }),
      },
      model: 'test-model',
    });
    const moves: Record<string, unknown>[] = [];
    session.getEventService().subscribe((event, data) => {
      if (event === PROVIDER_FALLBACK_EVENTS.SWITCHED) moves.push(data);
    });

    await session.run('question');

    expect(moves).toEqual([
      expect.objectContaining({
        fromProvider: 'anthropic',
        fromModel: 'test-model',
        toProvider: 'openai',
        toModel: 'gpt-next',
        reason: 'overloaded',
      }),
    ]);
  });
});
