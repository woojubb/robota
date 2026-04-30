import { describe, expect, it, vi } from 'vitest';
import type { IAIProvider, IChatOptions, TUniversalMessage } from '@robota-sdk/agent-core';
import { Session } from '../session.js';

function createSharedProvider(): IAIProvider & {
  onTextDelta?: (delta: string) => void;
} {
  return {
    name: 'mock-provider',
    version: '1.0.0',
    onTextDelta: undefined,
    chat: vi.fn(async (_messages: TUniversalMessage[], options?: IChatOptions) => {
      options?.onTextDelta?.('streamed text');
      return {
        id: 'assistant_1',
        role: 'assistant',
        content: 'final text',
        timestamp: new Date(),
        state: 'complete',
      };
    }),
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
    tools: [],
    provider,
    systemMessage: 'test system',
    terminal: createTerminal(),
    model: 'test-model',
    onTextDelta,
  });
}

describe('Session provider callback isolation', () => {
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
});
