import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { IAIProvider } from '@robota-sdk/agent-core';

const sessionCtorSpy = vi.fn();

vi.mock('@robota-sdk/agent-framework', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@robota-sdk/agent-framework')>();

  class FakeInteractiveSession {
    private readonly listeners = new Map<string, Array<(...args: unknown[]) => void>>();

    constructor(options: unknown) {
      sessionCtorSpy(options);
    }

    on(event: string, handler: (...args: unknown[]) => void): void {
      const list = this.listeners.get(event) ?? [];
      list.push(handler);
      this.listeners.set(event, list);
    }

    off(): void {}

    async submit(): Promise<void> {
      const result = {
        response: 'ok',
        history: [],
        toolSummaries: [],
        contextState: {},
      };
      for (const handler of this.listeners.get('complete') ?? []) {
        handler(result);
      }
    }

    getSession(): { getSessionId: () => string } {
      return { getSessionId: () => 'test-session' };
    }

    async shutdown(): Promise<void> {}
  }

  return { ...mod, InteractiveSession: FakeInteractiveSession };
});

import { HeadlessInteractionChannel } from '../HeadlessInteractionChannel.js';

describe('HeadlessInteractionChannel session options', () => {
  beforeEach(() => {
    sessionCtorSpy.mockClear();
  });

  it('TC-01: passes deniedTools through to the InteractiveSession options', async () => {
    const channel = new HeadlessInteractionChannel({
      cwd: process.cwd(),
      provider: {} as IAIProvider,
      outputFormat: 'text',
      allowedTools: ['Read'],
      deniedTools: ['Bash', 'Glob'],
      shellExec: () => '',
    });
    await channel.run('hello');
    expect(sessionCtorSpy).toHaveBeenCalledTimes(1);
    const options = sessionCtorSpy.mock.calls[0]?.[0] as {
      allowedTools?: string[];
      deniedTools?: string[];
    };
    expect(options.allowedTools).toEqual(['Read']);
    expect(options.deniedTools).toEqual(['Bash', 'Glob']);
  });
});
