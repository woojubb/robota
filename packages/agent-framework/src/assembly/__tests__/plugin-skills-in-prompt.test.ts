/**
 * The model is told about the bundle plugin skills it can activate, not only the session's own.
 */

import { describe, expect, it } from 'vitest';

import { createSession } from '../create-session.js';

import type { ICreateSessionOptions } from '../create-session-types.js';

const terminal: ICreateSessionOptions['terminal'] = {
  write: () => undefined,
  writeLine: () => undefined,
  writeMarkdown: () => undefined,
  writeError: () => undefined,
  prompt: async () => '',
  select: async () => 0,
  spinner: () => ({ stop: () => undefined, update: () => undefined }),
};

function options(extra: Partial<ICreateSessionOptions>): ICreateSessionOptions {
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
      supportsTools: () => true,
      validateConfig: () => true,
    },
    defaultTools: [],
    // A model-invocable skill-activation command, so the prompt lists the skills it can run.
    commandDescriptors: [
      {
        name: 'skills',
        kind: 'builtin-command',
        description: 'Run a skill',
        userInvocable: true,
        modelInvocable: true,
      },
    ],
    commandSemanticRoles: { skillActivation: 'skills' },
    ...extra,
  };
}

describe('the skills the model is told about', () => {
  it('include a bundle plugin skill it may activate', async () => {
    const { session } = await createSession(
      options({
        pluginSkills: () => [
          {
            name: 'tidy-plugin-skill',
            description: '(helper) Tidy the workspace',
            source: 'plugin',
            skillContent: 'Tidy.',
          },
        ],
      }),
    );

    expect(session.getSystemMessage()).toContain('tidy-plugin-skill');
  });

  it('leave out a plugin skill that is not model-invocable', async () => {
    const { session } = await createSession(
      options({
        pluginSkills: () => [
          {
            name: 'manual-plugin-skill',
            description: '(helper) Only by hand',
            source: 'plugin',
            skillContent: 'Manual.',
            disableModelInvocation: true,
          },
        ],
      }),
    );

    expect(session.getSystemMessage()).not.toContain('manual-plugin-skill');
  });
});
