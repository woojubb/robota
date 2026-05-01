import { describe, expect, it } from 'vitest';
import { BackgroundTaskManager } from '../index.js';
import {
  BackgroundJobOrchestrator,
  summarizeBackgroundJobGroup,
} from '../background-job-orchestrator.js';
import type {
  IBackgroundTaskHandle,
  IBackgroundTaskRequest,
  IBackgroundTaskResult,
  IBackgroundTaskRunner,
  IBackgroundTaskStart,
  TBackgroundJobGroupEvent,
} from '../index.js';

interface IControlledTask {
  taskId: string;
  resolve: (result: IBackgroundTaskResult) => void;
  reject: (error: Error) => void;
}

function createAgentRequest(label: string): IBackgroundTaskRequest {
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

function createControlledRunner(tasks: IControlledTask[]): IBackgroundTaskRunner {
  return {
    kind: 'agent',
    start(task: IBackgroundTaskStart): IBackgroundTaskHandle {
      let resolveResult: (result: IBackgroundTaskResult) => void = () => {};
      let rejectResult: (error: Error) => void = () => {};
      const tracked = new Promise<IBackgroundTaskResult>((resolve, reject) => {
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
