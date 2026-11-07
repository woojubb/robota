/**
 * #3679 step 3b: what a session saves about a sealed subagent transcript is what a resumed session
 * shows. The task state and the job-group result carry `transcriptSealed`, so a group summary read
 * after the resume points at `/agent read` and never names a path that reaches no content.
 */
import { BackgroundTaskManager } from '@robota-sdk/agent-executor';
import { describe, expect, it } from 'vitest';

import { SessionBackgroundTaskTracker } from '../interactive-session-background-tracker.js';

import type {
  IBackgroundTaskHandle,
  IBackgroundTaskRunner,
  IBackgroundTaskStart,
} from '@robota-sdk/agent-executor';
import type { IBackgroundTrackerState } from '../interactive-session-background-tracker.js';

const SESSION_ID = 'session-sealed';

function sealedRunner(): IBackgroundTaskRunner<'agent'> {
  return {
    kind: 'agent',
    start(task: IBackgroundTaskStart<'agent'>): IBackgroundTaskHandle<'agent'> {
      return {
        taskId: task.taskId,
        transcriptPath: `/logs/${SESSION_ID}/subagents/${task.taskId}.jsonl`,
        transcriptSealed: true,
        result: Promise.resolve({ taskId: task.taskId, kind: 'agent', output: 'the answer' }),
        cancel: () => Promise.resolve(),
      };
    },
  };
}

function trackerOver(manager: BackgroundTaskManager): SessionBackgroundTaskTracker {
  return new SessionBackgroundTaskTracker(
    () => manager,
    () => {},
    () => {},
    () => {},
    () => {},
  );
}

describe('a sealed subagent transcript across a save and a resume', () => {
  it('is still a sealed log, read through the command, in the group summary of the resumed session', async () => {
    const manager = new BackgroundTaskManager({ runners: [sealedRunner()] });
    const live = trackerOver(manager);
    const task = await manager.spawn({
      kind: 'agent',
      label: 'research',
      agentType: 'research',
      prompt: 'inspect',
      parentSessionId: SESSION_ID,
      mode: 'background',
      depth: 1,
      cwd: '/work',
      permissionPolicy: 'inherit-allowlist',
    });
    const group = live.createGroup({ waitPolicy: 'wait_all', taskIds: [task.id] }, SESSION_ID);
    await live.waitGroup(group.id, SESSION_ID);

    // What the session writes into its record, as it comes back off disk.
    const saved = JSON.parse(JSON.stringify(live.getState())) as IBackgroundTrackerState;
    expect(saved.tasks.find((state) => state.id === task.id)?.transcriptSealed).toBe(true);

    // A later process: a new manager that has never heard of the task.
    const resumed = trackerOver(new BackgroundTaskManager({ runners: [] }));
    resumed.restoreState(saved);
    const page = resumed.readGroupDetail('entry-1', group.id, SESSION_ID);

    const line = page.records.map((record) => record.text).join('\n');
    expect(line).toContain(`read it with /agent read ${task.id}`);
    expect(line).not.toContain('.jsonl');
  });
});
