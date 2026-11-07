import { BackgroundTaskManager } from '@robota-sdk/agent-executor';
import { describe, expect, it, vi } from 'vitest';

import {
  BackgroundJobOrchestrator,
  summarizeBackgroundJobGroup,
} from '../background-job-orchestrator.js';
import { createTestFrameworkHost } from '../../testing/framework-host.js';

import type { TBackgroundJobGroupEvent } from '../index.js';
import type {
  IBackgroundTaskHandle,
  IBackgroundTaskRunner,
  IBackgroundTaskStart,
} from '@robota-sdk/agent-executor';
import type {
  IBackgroundJobGroupState,
  IBackgroundTaskResult,
  TBackgroundTaskRequest,
} from '@robota-sdk/agent-interface-execution';

interface IControlledTask {
  taskId: string;
  resolve: (result: IBackgroundTaskResult<'agent'>) => void;
  reject: (error: Error) => void;
}

function createAgentRequest(label: string): TBackgroundTaskRequest {
  return {
    kind: 'agent',
    label,
    mode: 'background',
    parentSessionId: 'session_parent',
    depth: 1,
    cwd: '/workspace',
    agentType: 'general-purpose',
    prompt: `${label} prompt`,
    permissionPolicy: 'inherit-allowlist',
  };
}

function createControlledRunner(tasks: IControlledTask[]): IBackgroundTaskRunner<'agent'> {
  return {
    kind: 'agent',
    start(task: IBackgroundTaskStart<'agent'>): IBackgroundTaskHandle<'agent'> {
      let resolveResult: (result: IBackgroundTaskResult<'agent'>) => void = () => {};
      let rejectResult: (error: Error) => void = () => {};
      const tracked = new Promise<IBackgroundTaskResult<'agent'>>((resolve, reject) => {
        resolveResult = resolve;
        rejectResult = reject;
      });
      tasks.push({ taskId: task.taskId, resolve: resolveResult, reject: rejectResult });
      return {
        taskId: task.taskId,
        transcriptPath: `/tmp/${task.taskId}.jsonl`,
        result: tracked,
        cancel: () => Promise.resolve(),
      };
    },
  };
}

describe('BackgroundJobOrchestrator', () => {
  it.each([
    [undefined, 'BACKGROUND_OBSERVER_FAILURE'],
    ['ACME_BACKGROUND_OBSERVER_FAILURE', 'ACME_BACKGROUND_OBSERVER_FAILURE'],
  ])('uses warning code %s for a failing group listener', (warningCode, expectedCode) => {
    const spy = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
    try {
      const manager = new BackgroundTaskManager({ runners: [] });
      const orchestrator = new BackgroundJobOrchestrator({
        manager,
        reportObserverFailure: createTestFrameworkHost().reportObserverFailure,
        observerFailureWarningCode: warningCode,
      });
      orchestrator.subscribe(() => {
        throw new Error('broken');
      });
      orchestrator.createGroup({ parentSessionId: 'parent', waitPolicy: 'manual', taskIds: [] });
      expect(spy.mock.calls[0]?.[1]).toEqual({ code: expectedCode });
    } finally {
      spy.mockRestore();
    }
  });

  it.each([
    [undefined, 'BACKGROUND_OBSERVER_FAILURE'],
    ['ACME_BACKGROUND_OBSERVER_FAILURE', 'ACME_BACKGROUND_OBSERVER_FAILURE'],
  ])(
    "writes the executor's own line with code %s when the host lends no reporter",
    (warningCode, expectedCode) => {
      const process_ = vi.spyOn(process, 'emitWarning').mockImplementation(() => undefined);
      const console_ = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      try {
        const orchestrator = new BackgroundJobOrchestrator({
          manager: new BackgroundTaskManager({ runners: [] }),
          observerFailureWarningCode: warningCode,
        });
        orchestrator.subscribe(() => {
          throw new Error('broken');
        });
        orchestrator.createGroup({ parentSessionId: 'parent', waitPolicy: 'manual', taskIds: [] });
        expect(process_).not.toHaveBeenCalled();
        expect(console_).toHaveBeenCalledWith(
          expect.stringMatching(new RegExp(`^\\[${expectedCode}\\].*broken`, 'u')),
        );
      } finally {
        process_.mockRestore();
        console_.mockRestore();
      }
    },
  );

  it('completes a wait_all group after every task reaches terminal state', async () => {
    const controlled: IControlledTask[] = [];
    const manager = new BackgroundTaskManager({
      runners: [createControlledRunner(controlled)],
    });
    const orchestrator = new BackgroundJobOrchestrator({ manager });
    const developer = await manager.spawn(createAgentRequest('developer'));
    const designer = await manager.spawn(createAgentRequest('designer'));

    const group = orchestrator.createGroup({
      parentSessionId: 'session_parent',
      waitPolicy: 'wait_all',
      taskIds: [developer.id, designer.id],
    });
    const wait = orchestrator.waitGroup(group.id);

    controlled[0]!.resolve({
      taskId: developer.id,
      kind: 'agent',
      output: 'developer summary',
    });
    await manager.wait(developer.id);

    expect(orchestrator.getGroup(group.id)?.status).toBe('running');

    controlled[1]!.resolve({
      taskId: designer.id,
      kind: 'agent',
      output: 'designer summary',
    });

    const completed = await wait;
    expect(completed.status).toBe('completed');
    expect(completed.results).toEqual([
      expect.objectContaining({
        taskId: developer.id,
        label: 'developer',
        status: 'completed',
        summary: 'developer summary',
        outputRef: `/tmp/${developer.id}.jsonl`,
      }),
      expect.objectContaining({
        taskId: designer.id,
        label: 'designer',
        status: 'completed',
        summary: 'designer summary',
        outputRef: `/tmp/${designer.id}.jsonl`,
      }),
    ]);
  });

  it('completes a wait_any group once the first task reaches terminal state', async () => {
    const controlled: IControlledTask[] = [];
    const manager = new BackgroundTaskManager({
      runners: [createControlledRunner(controlled)],
    });
    const orchestrator = new BackgroundJobOrchestrator({ manager });
    const events: TBackgroundJobGroupEvent['type'][] = [];
    orchestrator.subscribe((event) => events.push(event.type));
    const first = await manager.spawn(createAgentRequest('first'));
    const second = await manager.spawn(createAgentRequest('second'));

    const group = orchestrator.createGroup({
      parentSessionId: 'session_parent',
      waitPolicy: 'wait_any',
      taskIds: [first.id, second.id],
    });

    controlled[0]!.resolve({ taskId: first.id, kind: 'agent', output: 'first summary' });

    const completed = await orchestrator.waitGroup(group.id);
    expect(completed.status).toBe('completed');
    expect(completed.results.map((result) => result.taskId)).toEqual([first.id]);
    expect(events.filter((event) => event === 'background_job_group_completed')).toHaveLength(1);

    controlled[1]!.resolve({ taskId: second.id, kind: 'agent', output: 'second summary' });
    await manager.wait(second.id);

    expect(events.filter((event) => event === 'background_job_group_completed')).toHaveLength(1);
  });

  it('continues default group ids after restored groups', () => {
    const manager = new BackgroundTaskManager({
      runners: [createControlledRunner([])],
    });
    const orchestrator = new BackgroundJobOrchestrator({
      manager,
      initialGroups: [
        {
          id: 'group_1',
          parentSessionId: 'session_parent',
          waitPolicy: 'manual',
          taskIds: [],
          status: 'running',
          createdAt: '2026-05-01T00:00:00.000Z',
          updatedAt: '2026-05-01T00:00:00.000Z',
          results: [],
        },
      ],
    });

    const created = orchestrator.createGroup({
      parentSessionId: 'session_parent',
      waitPolicy: 'manual',
      taskIds: [],
    });

    expect(created.id).toBe('group_2');
  });

  it('summarizes group status counts and result lines without raw logs', () => {
    const summary = summarizeBackgroundJobGroup({
      id: 'group_1',
      parentSessionId: 'session_parent',
      waitPolicy: 'wait_all',
      taskIds: ['agent_1', 'agent_2'],
      status: 'completed',
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:02.000Z',
      completedAt: '2026-05-01T00:00:02.000Z',
      results: [
        {
          taskId: 'agent_1',
          label: 'developer',
          status: 'completed',
          summary: '\n\n implementation summary \n',
          outputRef: '/tmp/agent_1.jsonl',
        },
        {
          taskId: 'agent_2',
          label: 'designer',
          status: 'failed',
          error: { category: 'runner', message: 'worker failed', recoverable: true },
        },
      ],
    });

    expect(summary).toEqual({
      groupId: 'group_1',
      status: 'completed',
      total: 2,
      completed: 1,
      failed: 1,
      cancelled: 0,
      pending: 0,
      lines: [
        '[completed] developer agent_1: implementation summary (output: /tmp/agent_1.jsonl)',
        '[failed] designer agent_2: worker failed',
      ],
    });
  });
});

/**
 * #3679 step 3b (R7): the job-group summary goes to the user and the model. A sealed transcript's
 * path reaches no content for either, so the summary names the command that reads it instead. The
 * fact rides on the saved envelope, so a group restored in a later session says the same thing.
 */
describe('BackgroundJobOrchestrator — a sealed transcript', () => {
  function runnerWith(sealed: boolean): IBackgroundTaskRunner<'agent'> {
    return {
      kind: 'agent',
      start(task: IBackgroundTaskStart<'agent'>): IBackgroundTaskHandle<'agent'> {
        return {
          taskId: task.taskId,
          transcriptPath: `/tmp/${task.taskId}.jsonl`,
          ...(sealed ? { transcriptSealed: true as const } : {}),
          result: Promise.resolve({ taskId: task.taskId, kind: 'agent', output: 'the answer' }),
          cancel: () => Promise.resolve(),
        };
      },
    };
  }

  async function completedGroup(sealed: boolean) {
    const manager = new BackgroundTaskManager({ runners: [runnerWith(sealed)] });
    const orchestrator = new BackgroundJobOrchestrator({ manager });
    const task = await manager.spawn(createAgentRequest('developer'));
    const group = orchestrator.createGroup({
      parentSessionId: 'session_parent',
      waitPolicy: 'wait_all',
      taskIds: [task.id],
    });
    const completed = await orchestrator.waitGroup(group.id);
    // The task and its handle are gone once it is closed; the saved group still says what it did.
    await manager.close(task.id);
    return { completed, taskId: task.id };
  }

  it('points at /agent read instead of the path, in the summary the user and the model see', async () => {
    const { completed } = await completedGroup(true);
    const line = summarizeBackgroundJobGroup(completed).lines[0];

    expect(line).toMatch(/ \(output: sealed log; read it with \/agent read task_\d+\)$/);
    expect(line).not.toContain('.jsonl');
  });

  it('marks the envelope it saves and keeps the path on it, a plain transcript leaves it unmarked', async () => {
    const sealed = await completedGroup(true);
    const plain = await completedGroup(false);

    expect(sealed.completed.results[0]).toMatchObject({
      outputRef: `/tmp/${sealed.taskId}.jsonl`,
      transcriptSealed: true,
    });
    expect(plain.completed.results[0]?.outputRef).toBe(`/tmp/${plain.taskId}.jsonl`);
    expect(plain.completed.results[0]).not.toHaveProperty('transcriptSealed');
  });

  it('says the same in a later session, from the saved group alone', async () => {
    const { completed } = await completedGroup(true);
    const saved = JSON.parse(JSON.stringify(completed)) as IBackgroundJobGroupState;
    const later = new BackgroundJobOrchestrator({
      manager: new BackgroundTaskManager({ runners: [] }),
      initialGroups: [saved],
    });

    const restored = later.getGroup(saved.id);
    expect(restored).toBeDefined();
    expect(summarizeBackgroundJobGroup(restored!)).toEqual(summarizeBackgroundJobGroup(completed));
    expect(summarizeBackgroundJobGroup(restored!).lines[0]).toMatch(/read it with \/agent read /);
  });

  it('keeps the path for a plain transcript', async () => {
    const { completed } = await completedGroup(false);

    expect(summarizeBackgroundJobGroup(completed).lines[0]).toMatch(
      / \(output: \/tmp\/task_\d+\.jsonl\)$/,
    );
  });
});
