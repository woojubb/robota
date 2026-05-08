import { describe, expect, it } from 'vitest';
import { BackgroundTaskManager } from '@robota-sdk/agent-runtime';
import type {
  IBackgroundTaskHandle,
  IBackgroundTaskRunner,
  IBackgroundTaskStart,
} from '@robota-sdk/agent-runtime';
import { BackgroundJobOrchestrator, createExecutionWorkspaceTaskSpawner } from '../index.js';

function createProcessRunner(): IBackgroundTaskRunner {
  return {
    kind: 'process',
    start(task: IBackgroundTaskStart): IBackgroundTaskHandle {
      return {
        taskId: task.taskId,
        result: Promise.resolve({ taskId: task.taskId, kind: 'process', output: 'done' }),
        cancel: () => Promise.resolve(),
      };
    },
  };
}

describe('execution workspace task spawner', () => {
  it('spawns process tasks with origin metadata through the runtime manager', async () => {
    const manager = new BackgroundTaskManager({ runners: [createProcessRunner()] });
    const groupOrchestrator = new BackgroundJobOrchestrator({ manager });
    const spawner = createExecutionWorkspaceTaskSpawner({
      manager,
      groupOrchestrator,
      sessionId: 'session_parent',
      cwd: '/workspace',
      origin: {
        kind: 'skill',
        sessionId: 'session_parent',
        skillId: 'release-check',
      },
    });

    const state = await spawner.spawnProcess({ command: 'pnpm test' });

    expect(state).toMatchObject({
      kind: 'process',
      label: 'pnpm test',
      parentSessionId: 'session_parent',
      metadata: {
        executionOriginKind: 'skill',
        executionOriginSessionId: 'session_parent',
        executionOriginSkillId: 'release-check',
      },
    });
  });
});
