/**
 * A subagent hook is a program of the same user, so it gets the transcript's
 * path and, when the transcript is sealed, `transcript_sealed: true` — never plaintext. Sealedness
 * is on the task state, which the manager projects from the runner's handle.
 */
import { describe, expect, it } from 'vitest';

import { createTestFrameworkHost } from '../../testing/framework-host.js';
import { buildAgentRuntime } from '../build-runtime.js';

import type { IHookInput, IHookTypeExecutor, THooksConfig } from '@robota-sdk/agent-core';
import type { IBackgroundTaskRunner } from '@robota-sdk/agent-executor';
import type { ICreateSessionOptions } from '../create-session-types.js';

const hooks: THooksConfig = {
  SubagentStart: [{ matcher: '', hooks: [{ type: 'command', command: 'unused' }] }],
  SubagentStop: [{ matcher: '', hooks: [{ type: 'command', command: 'unused' }] }],
};

async function hookInputsFor(sealed: boolean): Promise<IHookInput[]> {
  const inputs: IHookInput[] = [];
  let resolveStop!: () => void;
  const stopped = new Promise<void>((resolve) => {
    resolveStop = resolve;
  });
  const executor: IHookTypeExecutor = {
    type: 'command',
    execute: async (_definition, input) => {
      inputs.push(input);
      if (input.hook_event_name === 'SubagentStop') resolveStop();
      return { outcome: 'allow', source: 'command', stdout: '' };
    },
  };
  const runner: IBackgroundTaskRunner = {
    kind: 'agent',
    start: (task) => ({
      taskId: task.taskId,
      transcriptPath: `/logs/session-1/subagents/${task.taskId}.jsonl`,
      ...(sealed ? { transcriptSealed: true as const } : {}),
      result: Promise.resolve({ taskId: task.taskId, kind: 'agent', output: 'the final answer' }),
      cancel: async () => undefined,
    }),
  };
  const options = {
    host: createTestFrameworkHost(),
    config: { hooks },
    backgroundTaskRunners: [runner],
  } as unknown as ICreateSessionOptions;
  const runtime = buildAgentRuntime(
    options,
    'session-1',
    '/tmp/project',
    undefined as never,
    [],
    [executor],
  );
  const task = await runtime.backgroundTaskManager.spawn({
    kind: 'agent',
    label: 'research',
    agentType: 'research',
    prompt: 'inspect',
    parentSessionId: 'session-1',
    mode: 'foreground',
    depth: 1,
    cwd: '/tmp/project',
    permissionPolicy: 'inherit-allowlist',
  });
  await runtime.backgroundTaskManager.wait(task.id);
  await stopped;
  return inputs;
}

describe('subagent hooks and a sealed transcript', () => {
  it('say the transcript is sealed beside its path, and carry the final output', async () => {
    const inputs = await hookInputsFor(true);

    expect(inputs.map((input) => input.hook_event_name)).toEqual(['SubagentStart', 'SubagentStop']);
    // The flag goes wherever a transcript path goes, and only there.
    for (const input of inputs) {
      expect(input.transcript_sealed, input.hook_event_name).toBe(
        input.agent_transcript_path === undefined ? undefined : true,
      );
    }
    const stop = inputs[1];
    expect(stop?.agent_transcript_path).toMatch(/subagents\/.+\.jsonl$/);
    expect(stop?.transcript_sealed).toBe(true);
    expect(stop?.last_assistant_message).toBe('the final answer');
  });

  it('say nothing new for a plain transcript', async () => {
    const inputs = await hookInputsFor(false);

    for (const input of inputs) expect(input).not.toHaveProperty('transcript_sealed');
  });
});
