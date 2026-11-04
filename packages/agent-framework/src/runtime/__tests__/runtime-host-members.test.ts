import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { describe, expect, it, vi } from 'vitest';

import { createAgentRuntime, createStatelessRuntime } from '../../index.js';
import { createTestFrameworkHost } from '../../testing/framework-host.js';

import type { IBackgroundTaskRunner } from '@robota-sdk/agent-executor';

/**
 * What a runtime takes from the host it was built on. The background task runners come from
 * `host.createBackgroundTaskRunners` unless the runtime was given its own; a host that lends none has
 * no runner, so a task of any kind has nothing to start it.
 */
const provider = createScriptedProvider([]).provider;
const cwd = process.cwd();

function runnerOfKind(kind: IBackgroundTaskRunner['kind']): IBackgroundTaskRunner {
  return {
    kind,
    start: (task: { taskId: string }) => ({
      taskId: task.taskId,
      result: Promise.resolve({ taskId: task.taskId, kind, output: '' }),
      cancel: async () => undefined,
    }),
  } as unknown as IBackgroundTaskRunner;
}

describe('the background task runners of a runtime', () => {
  it('are the ones the host builds', () => {
    const built = [runnerOfKind('process')];
    const createBackgroundTaskRunners = vi.fn(() => built);
    const runtime = createAgentRuntime({
      host: createTestFrameworkHost({ createBackgroundTaskRunners }),
      cwd,
      provider,
    });
    expect(runtime.backgroundTaskRunners).toBe(built);
    expect(createBackgroundTaskRunners).toHaveBeenCalledOnce();
  });

  it('are the Node host runners, tool invocation among them, for the Node host', () => {
    const runtime = createAgentRuntime({ host: createTestFrameworkHost(), cwd, provider });
    expect(runtime.backgroundTaskRunners.map((runner) => runner.kind)).toContain('tool-invocation');
  });

  it("are the runtime's own when it is given them, and the host builds none", () => {
    const own = [runnerOfKind('agent')];
    const createBackgroundTaskRunners = vi.fn(() => [runnerOfKind('process')]);
    const runtime = createAgentRuntime({
      host: createTestFrameworkHost({ createBackgroundTaskRunners }),
      cwd,
      provider,
      backgroundTaskRunners: own,
    });
    expect(runtime.backgroundTaskRunners).toBe(own);
    expect(createBackgroundTaskRunners).not.toHaveBeenCalled();
  });

  it('are none when the host lends no factory, and a stateless runtime has the same', () => {
    expect(createAgentRuntime({ host: {}, cwd, provider }).backgroundTaskRunners).toEqual([]);
    expect(createStatelessRuntime({ host: {}, cwd, provider }).backgroundTaskRunners).toEqual([]);
  });
});
