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

  // RUNTIME-001: construction flows through buildRuntimeSession (wraps InteractiveSession in agent-framework).
  return {
    ...mod,
    InteractiveSession: FakeInteractiveSession,
    buildRuntimeSession: (options: unknown) => new FakeInteractiveSession(options),
  };
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

  it('TC-01 (CLI-063): passes resumeSessionId and forkSession through to the InteractiveSession options', async () => {
    const channel = new HeadlessInteractionChannel({
      cwd: process.cwd(),
      provider: {} as IAIProvider,
      outputFormat: 'text',
      resumeSessionId: 'session_prior_abc',
      forkSession: true,
      shellExec: () => '',
    });
    await channel.run('hello');
    expect(sessionCtorSpy).toHaveBeenCalledTimes(1);
    const options = sessionCtorSpy.mock.calls[0]?.[0] as {
      resumeSessionId?: string;
      forkSession?: boolean;
    };
    expect(options.resumeSessionId).toBe('session_prior_abc');
    expect(options.forkSession).toBe(true);
  });

  it('TC-01 (CLI-063): omits resume fields when not provided', async () => {
    const channel = new HeadlessInteractionChannel({
      cwd: process.cwd(),
      provider: {} as IAIProvider,
      outputFormat: 'text',
      shellExec: () => '',
    });
    await channel.run('hello');
    const options = sessionCtorSpy.mock.calls[0]?.[0] as {
      resumeSessionId?: string;
      forkSession?: boolean;
    };
    expect(options.resumeSessionId).toBeUndefined();
    expect(options.forkSession).toBeUndefined();
  });
});
