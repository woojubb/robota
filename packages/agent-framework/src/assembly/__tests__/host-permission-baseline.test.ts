import { describe, expect, it } from 'vitest';

import { createSession } from '../create-session.js';

import type { ICreateSessionOptions } from '../create-session-types.js';
import type { PermissionEnforcer } from '@robota-sdk/agent-session';

const terminal: ICreateSessionOptions['terminal'] = {
  write: () => undefined,
  writeLine: () => undefined,
  writeMarkdown: () => undefined,
  writeError: () => undefined,
  prompt: async () => '',
  select: async () => 0,
  spinner: () => ({ stop: () => undefined, update: () => undefined }),
};

function options(extra: Partial<ICreateSessionOptions> = {}): ICreateSessionOptions {
  return {
    config: {
      defaultTrustLevel: 'safe',
      provider: { name: 'test', model: 'test-model', apiKey: undefined },
      permissions: { allow: [], deny: [] },
      env: {},
    },
    context: { agentsMd: '', projectNotesMd: '' },
    terminal,
    provider: {
      name: 'test',
      version: 'test',
      chat: async () => ({
        id: 'reply',
        role: 'assistant',
        content: 'ok',
        timestamp: new Date(),
        state: 'complete',
      }),
      generateResponse: async () => ({ content: 'ok' }),
      supportsTools: () => false,
      validateConfig: () => true,
    },
    defaultTools: [],
    ...extra,
  };
}

function rules(session: Awaited<ReturnType<typeof createSession>>['session']) {
  return (session as unknown as { permissionEnforcer: PermissionEnforcer }).permissionEnforcer.currentPermissionRules();
}

describe('host-selected permission baseline', () => {
  it('does not approve product paths for a bare SDK session', async () => {
    const { session } = await createSession(options());
    expect(rules(session).allow).toEqual([]);
  });

  it('keeps an explicit host baseline when a live preset replaces its tool list', async () => {
    const { session } = await createSession(options({ baselinePermissionAllow: ['Read(custom/**)'], allowedTools: ['First'] }));
    expect(rules(session).allow).toEqual(['Read(custom/**)', 'First(*)']);
    session.applyPresetToolLists({ allowedTools: ['Second'] });
    expect(rules(session).allow).toEqual(['Read(custom/**)', 'Second(*)']);
  });
});
