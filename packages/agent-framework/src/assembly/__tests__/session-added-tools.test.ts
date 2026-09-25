/**
 * A tool the session adds after assembly — an MCP server connected after its sign-in — gets the
 * session-context wrappers every assembled tool got, not only the permission gate.
 */

import { describe, expect, it, vi } from 'vitest';

import { FunctionTool } from '@robota-sdk/agent-core';

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

function options(extra: Partial<ICreateSessionOptions> = {}): ICreateSessionOptions {
  return {
    config: {
      defaultTrustLevel: 'safe',
      provider: { name: 'test', model: 'test-model', apiKey: undefined },
      permissions: { allow: ['files__delete'], deny: [] },
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
    ...extra,
  };
}

describe('tools added to an assembled session', () => {
  it('are held to the reversible-execution policy like the assembled ones', async () => {
    const run = vi.fn(async () => 'deleted');
    const { session } = await createSession(
      options({ reversibleExecution: { mode: 'local-first' } }),
    );
    await session.addTools([
      new FunctionTool(
        {
          name: 'files__delete',
          description: 'Delete',
          parameters: { type: 'object', properties: {} },
        },
        run,
      ),
    ]);
    const result = await session.invokeRuntimeTool('files__delete', {});
    // An untracked side effect is refused under the policy, exactly as for an assembled tool.
    expect(run).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).toMatch(/requires|isolation|unknown|reversib/i);
    await session.shutdown();
  });
});
