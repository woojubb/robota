/**
 * #3282 §3 — a served runtime with no configured provider starts anyway, in setup mode: the session
 * carries a placeholder provider that never calls a model. `submit()` refuses a turn outright instead
 * of reaching it, so a client that submits before the GUI's setup screen has cleared the flag gets a
 * plain rejection (never a crash), and `getStatusSnapshot()` reports the flag so a client can show a
 * setup screen instead of a composer.
 */

import { describe, expect, it, vi } from 'vitest';

import { InteractiveSession } from '../interactive-session.js';

import type { IAIProvider } from '@robota-sdk/agent-core';

function placeholderProvider(): IAIProvider {
  return {
    name: 'setup-placeholder',
    version: '0',
    chat: vi.fn().mockRejectedValue(new Error('Connect a model provider to start.')),
    generateResponse: vi.fn().mockRejectedValue(new Error('Connect a model provider to start.')),
    supportsTools: () => false,
    validateConfig: () => false,
  };
}

describe('InteractiveSession — setup required (#3282 §3)', () => {
  it('refuses a submitted turn outright instead of reaching the placeholder provider', async () => {
    const provider = placeholderProvider();
    const session = new InteractiveSession({ cwd: '/tmp', provider, setupRequired: true });
    await expect(session.submit('hello')).rejects.toThrow('Connect a model provider to start.');
    // Never reached the provider — the guard is a refusal, not a failed call.
    expect(provider.chat).not.toHaveBeenCalled();
  });

  it('an ordinary session (no setupRequired) is not refused by this guard', async () => {
    const provider: IAIProvider = {
      name: 'mock',
      version: 'test',
      chat: vi.fn(),
      generateResponse: vi.fn(),
      supportsTools: () => false,
      validateConfig: () => true,
    };
    const session = new InteractiveSession({ cwd: '/tmp', provider });
    // It still fails (no real session store/init in this minimal fixture) — the point is that failure
    // is not the setup-required rejection, i.e. the guard did not fire.
    let message: string | undefined;
    try {
      await session.submit('hello');
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toBe('Connect a model provider to start.');
  });
});
