import { describe, expect, expectTypeOf, it } from 'vitest';
import { BackgroundTaskManager } from '../background-task-manager.js';
import { createToolInvocationBackgroundTaskRunner } from '../tool-invocation-runner.js';
import { createManagedShellProcessRunner } from '../runners/managed-shell-process-runner.js';
import { createScheduledTaskRunner } from '../runners/scheduled-task-runner.js';

import type {
  IBackgroundTaskHandle,
  IBackgroundTaskResult,
  IBackgroundTaskRunner,
  IBackgroundTaskStart,
  IProcessBackgroundTaskRequest,
  IScheduledBackgroundTaskRequest,
} from '../types.js';

const baseRequest = {
  label: 'test task',
  mode: 'background' as const,
  parentSessionId: 'session_1',
  depth: 0,
  cwd: '/workspace',
};

const processRequest: IProcessBackgroundTaskRequest = {
  ...baseRequest,
  kind: 'process',
  command: 'echo process',
};

const scheduledRequest: IScheduledBackgroundTaskRequest = {
  ...baseRequest,
  kind: 'scheduled',
  cronExpression: '* * * * *',
  command: 'echo scheduled',
};

// Compiled by the package typecheck. These calls are deliberately never executed: the public
// factory return type must reject another runner kind before a task reaches the runtime guard.
function checkConcreteRunnerKinds(): void {
  const invalidKind: IBackgroundTaskRunner = {
    // @ts-expect-error The dynamic manager port still accepts only registered task kinds.
    kind: 'invalid',
    start: () => {
      throw new Error('unreachable');
    },
  };
  void invalidKind;

  const scheduled = createScheduledTaskRunner();
  scheduled.start({ taskId: 'scheduled', request: scheduledRequest });
  // @ts-expect-error A scheduled runner cannot start a process request.
  scheduled.start({ taskId: 'process', request: processRequest });

  const process = createManagedShellProcessRunner();
  process.start({ taskId: 'process', request: processRequest });
  // @ts-expect-error A process runner cannot start a scheduled request.
  process.start({ taskId: 'scheduled', request: scheduledRequest });

  const invocation = createToolInvocationBackgroundTaskRunner();
  // @ts-expect-error A tool-invocation runner cannot start a process request.
  invocation.start({ taskId: 'process', request: processRequest });

  const agent: IBackgroundTaskRunner<'agent'> = {
    kind: 'agent',
    start: (task) => ({
      taskId: task.taskId,
      result: Promise.resolve({ taskId: task.taskId, kind: 'agent', output: '' }),
      cancel: async () => undefined,
    }),
  };
  // @ts-expect-error An agent runner cannot start a scheduled request.
  agent.start({ taskId: 'scheduled', request: scheduledRequest });
}
void checkConcreteRunnerKinds;

/**
 * #2079: compiled by the package typecheck. `IBackgroundTaskHandle<K>` resolves `result` to the
 * `K`-specific member of the discriminated `IBackgroundTaskResult`, so a runner started for a known
 * kind gets a correctly-narrowed result with no cast, and a cross-kind field on it is a compile error.
 */
function checkResultKindNarrowing(): void {
  const processHandle: IBackgroundTaskHandle<'process'> = {
    taskId: 'process_1',
    result: Promise.resolve({ taskId: 'process_1', kind: 'process', output: '', exitCode: 0 }),
    cancel: async () => undefined,
  };
  void processHandle.result.then((result) => {
    expectTypeOf(result).toEqualTypeOf<IBackgroundTaskResult<'process'>>();
    void result.exitCode;
    void result.signalCode;
    // @ts-expect-error A process result never carries agent-only token usage.
    void result.usage;
  });

  const agentHandle: IBackgroundTaskHandle<'agent'> = {
    taskId: 'agent_1',
    result: Promise.resolve({ taskId: 'agent_1', kind: 'agent', output: '' }),
    cancel: async () => undefined,
  };
  void agentHandle.result.then((result) => {
    expectTypeOf(result).toEqualTypeOf<IBackgroundTaskResult<'agent'>>();
    void result.usage;
    // @ts-expect-error An agent result never carries process-only exit information.
    void result.exitCode;
  });
}
void checkResultKindNarrowing;

describe('background runner kind contracts', () => {
  it('dispatches process and scheduled requests to the matching registered runner', async () => {
    const started: string[] = [];
    const process: IBackgroundTaskRunner<'process'> = {
      kind: 'process',
      start(task: IBackgroundTaskStart<'process'>) {
        started.push(`process:${task.request.command}`);
        return {
          taskId: task.taskId,
          result: Promise.resolve({ taskId: task.taskId, kind: 'process', output: 'process done' }),
          cancel: async () => undefined,
        };
      },
    };
    const scheduled: IBackgroundTaskRunner<'scheduled'> = {
      kind: 'scheduled',
      start(task: IBackgroundTaskStart<'scheduled'>) {
        started.push(`scheduled:${task.request.cronExpression}`);
        return {
          taskId: task.taskId,
          result: Promise.resolve({
            taskId: task.taskId,
            kind: 'scheduled',
            output: 'scheduled done',
          }),
          cancel: async () => undefined,
        };
      },
    };
    const manager = new BackgroundTaskManager({ runners: [process, scheduled] });

    const processTask = await manager.spawn(processRequest);
    const scheduledTask = await manager.spawn(scheduledRequest);
    expect((await manager.wait(processTask.id)).output).toBe('process done');
    expect((await manager.wait(scheduledTask.id)).output).toBe('scheduled done');
    expect(started).toEqual(['process:echo process', 'scheduled:* * * * *']);
    await manager.shutdown();
  });
});
