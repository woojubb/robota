/**
 * A child-process subagent writes its transcript under the log root so `/tasks` can show it. A run
 * that persists no session (`--no-session-persistence`) must write none: the transcript is the
 * subagent's whole conversation, and the log root outlives the run.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TRANSPORT_ENVIRONMENT } from '@robota-sdk/agent-executor';
import { createInProcessSubagentRunner } from '@robota-sdk/agent-framework';
import { createChildProcessSubagentRunnerFactory } from '@robota-sdk/agent-subagent-runner';

import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { createProductSubagentRunnerFactory } from '../subagent-composition.js';

import type { IProviderDefinition } from '@robota-sdk/agent-core';

vi.mock('@robota-sdk/agent-subagent-runner', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@robota-sdk/agent-subagent-runner')>();
  return {
    ...actual,
    createChildProcessSubagentRunnerFactory: vi.fn(actual.createChildProcessSubagentRunnerFactory),
  };
});

afterEach(() => vi.mocked(createChildProcessSubagentRunnerFactory).mockClear());

/** Builds the factory a child-process runner is chosen for: a referenced key, matching connection. */
function childProcessFactory(persistTranscripts: boolean) {
  const transport = Object.fromEntries(
    TRANSPORT_ENVIRONMENT.map((name) => [name, process.env[name]]),
  );
  const runtime = createTestProductRuntime('cedar', {
    ...transport,
    HOME: '/tmp/synthetic-home',
    SYNTHETIC_REF_KEY: 'synthetic-file-key',
  });
  const runner = createProductSubagentRunnerFactory({
    productRuntime: runtime,
    packContext: { cwd: '/tmp/synthetic-workspace' },
    providerConfig: {
      name: 'openai',
      model: 'fixture-model',
      apiKey: 'synthetic-file-key',
      apiKeyEnv: 'SYNTHETIC_REF_KEY',
    },
    providerDefinitions: [
      { type: 'openai', createProvider: () => ({}) } as unknown as IProviderDefinition,
    ],
    reproduction: { callerSuppliedDefinitions: false, replayProvider: false },
    notice: () => {},
    persistTranscripts,
  });
  expect(runner).not.toBe(createInProcessSubagentRunner);
  const options = vi.mocked(createChildProcessSubagentRunnerFactory).mock.calls[0]?.[0];
  if (options === undefined) throw new Error('the child-process runner was not built');
  return { runtime, options };
}

describe('child-process subagent transcripts', () => {
  it('are written under the log root when the run persists its session', () => {
    const { runtime, options } = childProcessFactory(true);

    expect(options.logsDir).toBe(runtime.config.storage.logRoot);
  });

  it('are not written at all when the run persists no session', () => {
    const { options } = childProcessFactory(false);

    expect(options).not.toHaveProperty('logsDir');
    // The children still seal as this process decides (here plain: it holds no keys), so a fork
    // record or a store a child opens follows the same decision as when transcripts are kept.
    expect(options.logSealing).toBe('plain');
  });
});
