import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IAIProvider } from '@robota-sdk/agent-core';

vi.mock('@robota-sdk/agent-framework', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@robota-sdk/agent-framework')>();

  class FakeInteractiveSession {
    on(): void {}
    off(): void {}
    getFullHistory(): unknown[] {
      return [];
    }
    getContextState(): never {
      throw new Error('ENOENT: session store unreadable');
    }
    getName(): string | undefined {
      return undefined;
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
    buildRuntimeSession: () => new FakeInteractiveSession(),
  };
});

import { TuiInteractionChannel } from '../TuiInteractionChannel.js';

describe('TuiInteractionChannel init failure surfacing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('TC-05: a real init error records a session-init-error entry and sets error state', async () => {
    const channel = new TuiInteractionChannel({
      cwd: '/tmp/project',
      provider: {} as IAIProvider,
    });
    await channel.start();

    vi.advanceTimersByTime(400);

    const entries = channel.stateManager.history;
    const initError = entries.find((e) => e.type === 'session-init-error');
    expect(initError).toBeDefined();
    const message = (initError?.data as { message?: string } | undefined)?.message ?? '';
    expect(message).toContain('Session initialization failed');
    expect(message).toContain('ENOENT');

    await channel.stop();
  });
});
