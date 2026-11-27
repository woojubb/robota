import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ManagedHelperProviderError, ManagedRunUnavailableError } from '@robota-sdk/agent-core';

import { createSession } from '../create-session.js';
import { createModelPermissionClassifier } from '../model-permission-classifier.js';
import { createTestFrameworkHost } from '../../testing/framework-host.js';

import type {
  IAIProvider,
  IManagedRunProvider,
  TExecutionJournalRecord,
} from '@robota-sdk/agent-core';
import type { ICreateSessionOptions } from '../create-session-types.js';

vi.mock('../model-permission-classifier.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../model-permission-classifier.js')>();
  return {
    ...actual,
    createModelPermissionClassifier: vi.fn(actual.createModelPermissionClassifier),
  };
});

const classifierFactory = vi.mocked(createModelPermissionClassifier);
const testHost = createTestFrameworkHost();

beforeEach(() => classifierFactory.mockClear());

const terminal: ICreateSessionOptions['terminal'] = {
  write: () => undefined,
  writeLine: () => undefined,
  writeMarkdown: () => undefined,
  writeError: () => undefined,
  prompt: async () => '',
  select: async () => 0,
  spinner: () => ({ stop: () => undefined, update: () => undefined }),
};

function modelStep(name: string): IAIProvider {
  return {
    name,
    version: 'test',
    chat: vi.fn(async () => ({
      id: 'reply',
      role: 'assistant',
      content: 'ok',
      timestamp: new Date(),
      state: 'complete',
    })),
    generateResponse: async () => ({ content: 'ok' }),
    supportsTools: () => false,
    validateConfig: () => true,
  } as never;
}

function managed(isolated: boolean): IManagedRunProvider & { run: ReturnType<typeof vi.fn> } {
  return {
    kind: 'managed-run',
    name: 'managed',
    version: 'test',
    ...(isolated ? { isolatesHelperRequests: true as const } : {}),
    validateConfig: () => true,
    run: vi.fn(async () => ({
      id: 'final',
      role: 'assistant',
      content: 'managed answer',
      timestamp: new Date(),
      state: 'complete',
    })),
  } as never;
}

function options(extra: Partial<ICreateSessionOptions>): ICreateSessionOptions {
  return {
    cwd: process.cwd(),
    host: testHost,
    config: {
      defaultTrustLevel: 'safe',
      provider: { name: 'test', model: 'test-model', apiKey: undefined },
      permissions: { allow: [], deny: [] },
      env: {},
    },
    context: { agentsMd: '', projectNotesMd: '' },
    terminal,
    defaultTools: [],
    ...extra,
  };
}

function journal() {
  const records: TExecutionJournalRecord[] = [];
  return {
    append: async (record: TExecutionJournalRecord) => void records.push(structuredClone(record)),
    read: async (executionId: string) => records.filter((r) => r.executionId === executionId),
  };
}

describe('createSession with a managed provider', () => {
  it('runs a turn: no provider timeout is set for it, not even the default', async () => {
    const provider = managed(false);
    const { session } = await createSession(options({ provider }));
    await expect(session.runRecoverable('hi', { executionJournal: journal() })).resolves.toEqual({
      status: 'completed',
      response: 'managed answer',
    });
    expect(provider.run).toHaveBeenCalledOnce();
  });

  it('refuses a managed helper provider with a typed error', async () => {
    await expect(
      createSession(options({ provider: managed(true), helperProvider: managed(true) as never })),
    ).rejects.toBeInstanceOf(ManagedHelperProviderError);
  });

  it('refuses subagents, which run model requests', async () => {
    await expect(
      createSession(options({ provider: managed(true), enableAgentRuntime: true })),
    ).rejects.toBeInstanceOf(ManagedRunUnavailableError);
  });

  it('builds the classifier only from the helper when the provider declares isolation', async () => {
    const provider = managed(true);
    const helper = modelStep('helper');
    const { session } = await createSession(options({ provider, helperProvider: helper }));
    expect(classifierFactory).toHaveBeenCalledOnce();
    expect(classifierFactory.mock.calls[0]?.[0]).toBe(helper);
    expect(() => session.setPermissionMode('auto')).not.toThrow();
    expect(provider.run).not.toHaveBeenCalled();
  });

  it('refuses auto without an isolated classifier and names what to configure', async () => {
    const notIsolated = await createSession(
      options({ provider: managed(false), helperProvider: modelStep('helper') }),
    );
    expect(() => notIsolated.session.setPermissionMode('auto')).toThrow(/isolatesHelperRequests/);
    const noHelper = await createSession(options({ provider: managed(true) }));
    expect(() => noHelper.session.setPermissionMode('auto')).toThrow(/helperProvider/);
    expect(classifierFactory).not.toHaveBeenCalled();
  });

  it('never derives a helper from the environment or defaults', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-test-not-real');
    vi.stubEnv('OPENAI_API_KEY', 'sk-test-not-real');
    try {
      const providerFactory = vi.fn();
      const { session } = await createSession(
        options({ provider: managed(true), providerFactory }),
      );
      expect(session.getHelperProvider()).toBeUndefined();
      expect(classifierFactory).not.toHaveBeenCalled();
      expect(() => session.setPermissionMode('auto')).toThrow();
      await session.runRecoverable('hi', { executionJournal: journal() });
      expect(providerFactory).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('createSession with a model-step provider', () => {
  it('still builds the classifier from the session provider and allows auto', async () => {
    const provider = modelStep('main');
    const { session } = await createSession(options({ provider }));
    expect(classifierFactory).toHaveBeenCalledOnce();
    expect(classifierFactory.mock.calls[0]?.[0]).toBe(provider);
    expect(() => session.setPermissionMode('auto')).not.toThrow();
  });
});
