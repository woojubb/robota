import { describe, expect, it, vi } from 'vitest';

import { createSession } from '../create-session.js';
import { createSubagentSession } from '../create-subagent-session.js';
import {
  createModelPermissionClassifier,
  parseClassifierVerdict,
  PERMISSION_CLASSIFIER_SYSTEM_PROMPT,
} from '../model-permission-classifier.js';

import type { ICreateSessionOptions } from '../create-session-types.js';
import type { IAIProvider, TUniversalMessage } from '@robota-sdk/agent-core';

function providerAnswering(content: string): IAIProvider & { chat: ReturnType<typeof vi.fn> } {
  return {
    name: 'test',
    version: 'test',
    chat: vi.fn(async () => ({
      id: 'reply',
      role: 'assistant' as const,
      content,
      timestamp: new Date(),
      state: 'complete' as const,
    })),
    generateResponse: async () => ({ content }),
    supportsTools: () => false,
    validateConfig: () => true,
  } as unknown as IAIProvider & { chat: ReturnType<typeof vi.fn> };
}

describe('parseClassifierVerdict', () => {
  it('reads the JSON verdict, even wrapped in prose or a code fence', () => {
    expect(parseClassifierVerdict('{"decision":"allow","reason":"a build"}')).toEqual({
      decision: 'allow',
      reason: 'a build',
    });
    expect(
      parseClassifierVerdict('```json\n{"decision": "block", "reason": "force push"}\n```'),
    ).toEqual({ decision: 'block', reason: 'force push' });
  });

  it.each(['', 'allow', '{"decision":"maybe"}', '{not json}', '[1]'])(
    'is no verdict for %j',
    (raw) => {
      expect(parseClassifierVerdict(raw)).toBeUndefined();
    },
  );

  it('fills a missing reason', () => {
    expect(parseClassifierVerdict('{"decision":"block"}')).toEqual({
      decision: 'block',
      reason: 'no reason given',
    });
  });
});

describe('createModelPermissionClassifier', () => {
  it('shows the model the call and the trust boundary, nothing from the conversation', async () => {
    const provider = providerAnswering('{"decision":"block","reason":"unknown remote"}');
    const readRemotes = vi.fn(async () => ['git@github.com:me/repo.git']);
    const classifier = createModelPermissionClassifier(provider, {
      cwd: '/w/project',
      model: 'm',
      readRemotes,
    });

    const verdict = await classifier.classify({
      toolName: 'Bash',
      toolArgs: { command: 'git push other main' },
      cwd: '/w/project',
    });
    await classifier.classify({ toolName: 'Bash', toolArgs: { command: 'ls' }, cwd: '/w/project' });

    expect(verdict).toEqual({ decision: 'block', reason: 'unknown remote' });
    expect(readRemotes).toHaveBeenCalledOnce();
    const [messages, chatOptions] = provider.chat.mock.calls[0]! as [
      TUniversalMessage[],
      Record<string, unknown>,
    ];
    expect(messages).toHaveLength(2);
    expect(messages[0]!.content).toBe(PERMISSION_CLASSIFIER_SYSTEM_PROMPT);
    expect(messages[1]!.content).toContain('git@github.com:me/repo.git');
    expect(messages[1]!.content).toContain('git push other main');
    expect(chatOptions).toMatchObject({ toolChoice: 'none', model: 'm' });
  });
});

describe('createSession and auto mode', () => {
  function options(extra: Partial<ICreateSessionOptions> = {}): ICreateSessionOptions {
    return {
      config: {
        defaultTrustLevel: 'safe',
        provider: { name: 'test', model: 'test-model', apiKey: undefined },
        permissions: { allow: [], deny: [] },
        env: {},
      },
      context: { agentsMd: '', projectNotesMd: '' },
      terminal: {
        write: () => undefined,
        writeLine: () => undefined,
        writeMarkdown: () => undefined,
        writeError: () => undefined,
        prompt: async () => '',
        select: async () => 0,
        spinner: () => ({ stop: () => undefined, update: () => undefined }),
      },
      provider: providerAnswering('ok'),
      defaultTools: [],
      ...extra,
    };
  }

  it('a session can enter auto mode', async () => {
    const { session } = await createSession(options());
    session.setPermissionMode('auto');
    expect(session.getPermissionMode()).toBe('auto');
  });

  it('a session with auto mode disabled refuses it, at start and later', async () => {
    const { session } = await createSession(options({ disableAutoMode: true }));
    expect(() => session.setPermissionMode('auto')).toThrow(/Auto mode is unavailable/);
    expect(session.getPermissionMode()).not.toBe('auto');
    await expect(
      createSession(options({ disableAutoMode: true, permissionMode: 'auto' })),
    ).rejects.toThrow(/Auto mode is unavailable/);
  });

  it('a subagent or forked skill of an auto-mode session runs in auto mode too', () => {
    const base = options();
    const child = createSubagentSession({
      agentDefinition: { name: 'worker', description: 'w', systemPrompt: 'Work.' },
      parentConfig: base.config,
      parentContext: base.context,
      parentTools: [],
      provider: base.provider!,
      terminal: base.terminal,
      cwd: process.cwd(),
      permissionMode: 'auto',
    });
    expect(child.getPermissionMode()).toBe('auto');
  });
});
