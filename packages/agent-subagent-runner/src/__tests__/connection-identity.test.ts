/**
 * One provider connection identity across the child-process boundary.
 *
 * The parent's credential must never reach a child that would send it somewhere the parent would
 * not: every environment variable that decides where a provider connects is compared before the
 * child is spawned, and the child builds its provider from the payload exactly.
 */

import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { projectProviderConnection } from '../child-process-subagent-projection.js';
import { ChildProcessSubagentRunner } from '../index.js';

import type { IProviderDefinition } from '@robota-sdk/agent-core';
import type { ISubagentJobStart, ISubagentWorktreeAdapter } from '@robota-sdk/agent-executor';
import type { IInProcessSubagentRunnerDeps } from '@robota-sdk/agent-framework';

const FIXTURE_WORKER_ENTRY = {
  execPath: process.execPath,
  args: [fileURLToPath(new URL('./fixtures/subagent-worker-fixture.mjs', import.meta.url))],
  execArgv: [] as readonly string[],
};
const ENV_DRIFT_WORKER_ENTRY = {
  execPath: process.execPath,
  args: [fileURLToPath(new URL('./fixtures/env-drift-worker-entry.mjs', import.meta.url))],
  execArgv: [] as readonly string[],
};
const TEST_TIMEOUT_MS = 20_000;
const STUB_WORKTREE_ADAPTER: ISubagentWorktreeAdapter = {
  prepare: () => {
    throw new Error('not used');
  },
  isClean: () => true,
  remove: () => {},
};

/** An OpenAI-shaped definition: its SDK reads `OPENAI_BASE_URL` when no base URL is configured. */
const OPENAI_LIKE: IProviderDefinition = {
  type: 'openai',
  destinationEnvironment: ['OPENAI_BASE_URL'],
  createProvider: () => {
    throw new Error('not built in the parent');
  },
};

function deps(
  provider: Partial<IInProcessSubagentRunnerDeps['config']['provider']> = {},
): IInProcessSubagentRunnerDeps {
  return {
    config: {
      defaultTrustLevel: 'moderate',
      currentProvider: 'openai',
      provider: { name: 'openai', model: 'test-model', apiKey: 'sk-canary', ...provider },
      permissions: { allow: [], deny: [] },
      env: {},
    },
    context: { agentsMd: '', projectNotesMd: '' },
    tools: [],
    terminal: {
      write: () => {},
      writeLine: () => {},
      writeMarkdown: () => {},
      writeError: () => {},
      prompt: () => Promise.resolve(''),
      select: () => Promise.resolve(0),
      spinner: () => ({ stop: () => {}, update: () => {} }),
    },
    provider: { name: 'mock' } as never,
    customAgentRegistry: () => ({ name: 'tester', description: 't', systemPrompt: 'Test.' }),
  };
}

function job(): ISubagentJobStart {
  return {
    taskId: 'agent_canary',
    request: {
      permissionPolicy: 'inherit-allowlist' as const,
      agentType: 'tester',
      label: 'Tester',
      parentSessionId: 'session_1',
      mode: 'background',
      depth: 1,
      cwd: process.cwd(),
      prompt: 'do work',
    },
  };
}

function runner(
  env: NodeJS.ProcessEnv,
  runnerDeps: IInProcessSubagentRunnerDeps = deps(),
): ChildProcessSubagentRunner {
  return new ChildProcessSubagentRunner(runnerDeps, {
    workerEntry: FIXTURE_WORKER_ENTRY,
    worktreeAdapter: STUB_WORKTREE_ADAPTER,
    providerDefinitions: [OPENAI_LIKE],
    env: { ROBOTA_FIXTURE_MODE: 'echo-profile', ...env },
  });
}

describe('provider connection identity (alternate-endpoint canary)', () => {
  it(
    'refuses, before spawning, a child whose environment would point the provider elsewhere',
    () => {
      // The parent has no OPENAI_BASE_URL; the child would. With no configured base URL the
      // provider SDK reads that variable, so the parent's key would go to the capture address.
      const capture = runner({ OPENAI_BASE_URL: 'http://127.0.0.1:9/capture' });

      expect(() => capture.start(job())).toThrow(/OPENAI_BASE_URL/);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'refuses a changed transport variable, which no provider declares',
    () => {
      const proxied = runner({ HTTPS_PROXY: 'http://127.0.0.1:9/proxy' });

      expect(() => proxied.start(job())).toThrow(/HTTPS_PROXY/);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'refuses a credential reference the child would resolve to a different value',
    () => {
      process.env.CONNECTION_IDENTITY_TEST_KEY = 'sk-parent';
      try {
        const rebound = runner(
          { CONNECTION_IDENTITY_TEST_KEY: 'sk-child' },
          deps({ apiKeyEnv: 'CONNECTION_IDENTITY_TEST_KEY' }),
        );

        expect(() => rebound.start(job())).toThrow(/CONNECTION_IDENTITY_TEST_KEY/);
      } finally {
        delete process.env.CONNECTION_IDENTITY_TEST_KEY;
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'names the variable and never its value',
    () => {
      const capture = runner({ OPENAI_BASE_URL: 'http://secret-host.invalid/capture' });

      expect(() => capture.start(job())).toThrow(
        expect.objectContaining({ message: expect.not.stringContaining('secret-host') }),
      );
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'starts a child whose environment agrees, and hands it the check to repeat',
    async () => {
      const agreeing = runner({});

      const result = await agreeing.start(job()).result;
      const profile = JSON.parse((result as { output: string }).output) as Record<string, unknown>;

      expect(profile.type).toBe('openai');
    },
    TEST_TIMEOUT_MS,
  );

  it(
    'the child refuses when its environment changed after the parent checked it',
    async () => {
      const drifting = new ChildProcessSubagentRunner(deps(), {
        workerEntry: ENV_DRIFT_WORKER_ENTRY,
        worktreeAdapter: STUB_WORKTREE_ADAPTER,
        providerDefinitions: [OPENAI_LIKE],
      });

      await expect(drifting.start(job()).result).rejects.toThrow(/changed after the parent/);
    },
    TEST_TIMEOUT_MS,
  );
});

describe('the projected connection', () => {
  it('carries the effective base URL, with the definition default applied', () => {
    const withDefault: IProviderDefinition = {
      ...OPENAI_LIKE,
      defaults: { baseURL: 'https://default.invalid/v1', options: { apiSurface: 'responses' } },
    };
    const { providerProfile } = projectProviderConnection(
      job(),
      deps(),
      { providerDefinitions: [withDefault] },
      {},
      {},
    );
    expect(providerProfile.baseURL).toBe('https://default.invalid/v1');
    expect(providerProfile.options).toEqual({ apiSurface: 'responses' });
  });

  it('names a profile only when the connection came from it', () => {
    const fromSettings = projectProviderConnection(
      job(),
      deps(),
      { providerDefinitions: [OPENAI_LIKE] },
      {},
      {},
    );
    expect(fromSettings.providerProfile.profileName).toBe('openai');
    const fromRunner = projectProviderConnection(
      job(),
      deps(),
      {
        providerConfig: { name: 'openai', model: 'other', apiKey: 'sk-other' },
        providerDefinitions: [OPENAI_LIKE],
      },
      {},
      {},
    );
    expect(fromRunner.providerProfile.profileName).toBeUndefined();
  });

  it('sends the definition default credential, as the variable it names, when none is configured', () => {
    const withDefaultKey: IProviderDefinition = {
      ...OPENAI_LIKE,
      defaults: { apiKey: '$ENV:OPENAI_API_KEY' },
    };
    const { providerProfile, connectionCheck } = projectProviderConnection(
      job(),
      deps({ apiKey: undefined }),
      { providerDefinitions: [withDefaultKey] },
      {},
      {},
    );
    expect(providerProfile.apiKeyEnv).toBe('OPENAI_API_KEY');
    expect(providerProfile.apiKey).toBeUndefined();
    expect(connectionCheck.names).toContain('OPENAI_API_KEY');
  });

  it('refuses a provider the runner was given no definition for', () => {
    expect(() =>
      projectProviderConnection(
        job(),
        deps({ name: 'gemma' }),
        { providerDefinitions: [OPENAI_LIKE] },
        {},
        {},
      ),
    ).toThrow(/No provider definition for "gemma"/);
  });
});
