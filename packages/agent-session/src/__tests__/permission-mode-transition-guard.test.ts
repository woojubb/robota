import { describe, expect, it, vi } from 'vitest';

import { Session } from '../session.js';

import type { IAIProvider } from '@robota-sdk/agent-core';

function session(): Session {
  return new Session({
    cwd: process.cwd(),
    tools: [],
    provider: { name: 'mock', version: '1', chat: vi.fn() } as unknown as IAIProvider,
    systemMessage: 'test',
    terminal: { write: vi.fn(), writeLine: vi.fn(), writeError: vi.fn() } as never,
  });
}

describe('session permission-mode transition guards', () => {
  it('rejects a forbidden transition from every setter caller without changing the mode', () => {
    const sut = session();
    const release = sut.addPermissionModeGuard((next) => {
      if (next === 'bypassPermissions') throw new Error('external event ingress is active');
    });
    expect(() => sut.setPermissionMode('bypassPermissions')).toThrow(/external event/);
    expect(sut.getPermissionMode()).toBe('default');
    sut.setPermissionMode('plan');
    expect(sut.getPermissionMode()).toBe('plan');
    release();
    sut.setPermissionMode('bypassPermissions');
    expect(sut.getPermissionMode()).toBe('bypassPermissions');
  });
});
