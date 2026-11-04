import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { describe, expect, it } from 'vitest';

import { createSession } from '../assembly/create-session.js';
import { createQuery } from '../query.js';
import { createStatelessRuntime } from '../runtime/stateless-runtime.js';
import { createTestFrameworkHost } from '../testing/framework-host.js';

import type { ICreateSessionOptions } from '../assembly/create-session-types.js';
import type { ICreateQueryOptions } from '../query.js';
import type { IStatelessRuntimeConfig } from '../runtime/stateless-runtime.js';

/**
 * The working directory is passed in, never read from the process. `createSession` and
 * `createQuery` used to fall back to `process.cwd()` when a caller left `cwd` out; a JavaScript
 * caller who still does is refused instead of being given whichever directory the process is in.
 */
const host = createTestFrameworkHost();
const provider = createScriptedProvider([]).provider;

describe('a missing cwd is refused instead of defaulting to the process directory', () => {
  it('createQuery', () => {
    const options = { host, provider } as unknown as ICreateQueryOptions;
    expect(() => createQuery(options)).toThrow(/cwd is required/u);
  });

  it('createStatelessRuntime, before it returns a runtime with no root', () => {
    const config = { host, provider } as unknown as IStatelessRuntimeConfig;
    expect(() => createStatelessRuntime(config)).toThrow(/^createStatelessRuntime requires `cwd`/u);
  });

  it('createSession', async () => {
    const options = {
      host,
      provider,
      config: {
        defaultTrustLevel: 'safe',
        provider: { name: 'test', model: 'test-model', apiKey: undefined },
        permissions: { allow: [], deny: [] },
        env: {},
      },
      context: { agentsMd: '', projectNotesMd: '' },
      defaultTools: [],
      terminal: {
        write: () => undefined,
        writeLine: () => undefined,
        writeMarkdown: () => undefined,
        writeError: () => undefined,
        prompt: async () => '',
        select: async () => 0,
        spinner: () => ({ stop: () => undefined, update: () => undefined }),
      },
    } as unknown as ICreateSessionOptions;
    await expect(createSession(options)).rejects.toThrow(/Session requires `cwd`/u);
  });
});
