import { describe, expect, it, vi } from 'vitest';

import { createTestFrameworkHost } from '../../testing/framework-host.js';
import { buildAgentRuntime } from '../build-runtime.js';

import type { IBackgroundTaskRunner } from '@robota-sdk/agent-executor';
import type { ICreateSessionOptions } from '../create-session-types.js';

/**
 * The executor is platform-neutral and logs a failing lifecycle observer by default; the host's
 * `reportObserverFailure` is what makes it a process warning carrying the product's code, and a host
 * that lends none leaves the executor's own line.
 */
const runner: IBackgroundTaskRunner = {
  kind: 'agent',
  start: (task) => ({
    taskId: task.taskId,
    result: Promise.resolve({ taskId: task.taskId, kind: 'agent', output: 'done' }),
    cancel: async () => undefined,
  }),
};

const request = {
  kind: 'agent' as const,
  label: 'research',
  agentType: 'research',
  prompt: 'inspect',
  parentSessionId: 'session-1',
  mode: 'foreground' as const,
  depth: 1,
  cwd: '/tmp/project',
  permissionPolicy: 'inherit-allowlist' as const,
};

describe('background task manager observer failures at runtime assembly', () => {
  it.each([
    { name: 'without the agent runtime', agentRuntime: {} },
    {
      name: 'with the agent runtime',
      agentRuntime: {
        enableAgentRuntime: true,
        subagentRunnerFactory: () => ({ start: runner.start }),
      },
    },
  ])('reports a throwing observer as a coded process warning $name', async ({ agentRuntime }) => {
    const spy = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
    try {
      const options = {
        host: createTestFrameworkHost(),
        config: { hooks: {} },
        backgroundTaskRunners: [runner],
        observerFailureWarningCode: 'ACME_BACKGROUND_OBSERVER_FAILURE',
        ...agentRuntime,
      } as unknown as ICreateSessionOptions;
      const runtime = buildAgentRuntime(
        options,
        'session-1',
        '/tmp/project',
        undefined as never,
        [],
        [],
      );
      runtime.backgroundTaskManager.subscribe(() => {
        throw new Error('broken');
      });
      const task = await runtime.backgroundTaskManager.spawn(request);
      await runtime.backgroundTaskManager.wait(task.id);
      expect(spy).toHaveBeenCalled();
      expect(
        spy.mock.calls.every(
          (call) => (call[1] as { code?: string }).code === 'ACME_BACKGROUND_OBSERVER_FAILURE',
        ),
      ).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('a host with no observer reporter', () => {
  it.each([
    { name: 'without the agent runtime', agentRuntime: {} },
    {
      name: 'with the agent runtime',
      agentRuntime: {
        enableAgentRuntime: true,
        subagentRunnerFactory: () => ({ start: runner.start }),
      },
    },
  ])("leaves the executor's own console line, coded, $name", async ({ agentRuntime }) => {
    const process_ = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
    const console_ = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const options = {
        host: createTestFrameworkHost({ reportObserverFailure: undefined }),
        config: { hooks: {} },
        backgroundTaskRunners: [runner],
        observerFailureWarningCode: 'ACME_BACKGROUND_OBSERVER_FAILURE',
        ...agentRuntime,
      } as unknown as ICreateSessionOptions;
      const runtime = buildAgentRuntime(
        options,
        'session-1',
        '/tmp/project',
        undefined as never,
        [],
        [],
      );
      runtime.backgroundTaskManager.subscribe(() => {
        throw new Error('broken');
      });
      const task = await runtime.backgroundTaskManager.spawn(request);
      await runtime.backgroundTaskManager.wait(task.id);
      expect(process_).not.toHaveBeenCalled();
      expect(console_).toHaveBeenCalledWith(
        expect.stringMatching(/^\[ACME_BACKGROUND_OBSERVER_FAILURE\].*broken/u),
      );
    } finally {
      process_.mockRestore();
      console_.mockRestore();
    }
  });
});
