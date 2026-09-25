/**
 * Compaction's input was sized to the session's model, so its request tells a provider that can
 * answer on another model not to pick one with a smaller context window.
 */

import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { CompactionOrchestrator } from '../compaction-orchestrator.js';

import type { IAIProvider, IChatOptions, TUniversalMessage } from '@robota-sdk/agent-core';

describe('compaction request', () => {
  it('asks any substitute model to keep the requested context window', async () => {
    const received: IChatOptions[] = [];
    const provider = {
      name: 'capturing',
      chat: async (_messages: TUniversalMessage[], options: IChatOptions = {}) => {
        received.push(options);
        return {
          id: randomUUID(),
          role: 'assistant' as const,
          content: 'summary',
          state: 'complete' as const,
          timestamp: new Date(),
        };
      },
    } as IAIProvider;
    const orchestrator = new CompactionOrchestrator({
      sessionId: 'compaction-context-window',
      cwd: process.cwd(),
      model: 'session-model',
    });

    await orchestrator.compact(provider, [
      { id: randomUUID(), role: 'user', content: 'hi', state: 'complete', timestamp: new Date() },
    ]);

    expect(received).toEqual([
      expect.objectContaining({ model: 'session-model', preserveContextWindow: true }),
    ]);
  });
});
