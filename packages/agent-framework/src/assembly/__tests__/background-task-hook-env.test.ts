import { describe, expect, it } from 'vitest';

import { fireSubagentLifecycleHook } from '../background-task-hooks.js';
import { buildAgentRuntime } from '../build-agent-runtime.js';

import type { IHookInput, IHookTypeExecutor, THooksConfig } from '@robota-sdk/agent-core';
import type { IBackgroundTaskRunner } from '@robota-sdk/agent-executor';
import type { TBackgroundTaskEvent } from '@robota-sdk/agent-interface-execution';
import type { ICreateSessionOptions } from '../create-session-types.js';

const event: TBackgroundTaskEvent = {
  type: 'background_task_started',
  task: {
    id: 'agent-1', kind: 'agent', label: 'research', agentType: 'research',
    status: 'running', mode: 'background', parentSessionId: 'session-1',
    depth: 0, cwd: '/tmp/project', updatedAt: '2026-01-01T00:00:00.000Z', unread: false,
  },
};

const hooks: THooksConfig = {
  SubagentStart: [{ matcher: '', hooks: [{ type: 'command', command: 'unused' }] }],
};

function captureHookInput(
  aliases?: { readonly agentId: string; readonly agentType: string },
): Promise<IHookInput> {
  return new Promise<IHookInput>((resolve) => {
    const executor: IHookTypeExecutor = {
      type: 'command',
      execute: async (_definition, input) => {
        resolve(input);
        return { outcome: 'allow', source: 'command', stdout: '' };
      },
    };
    fireSubagentLifecycleHook(event, '/tmp/project', hooks, [executor], aliases);
  });
}

describe('subagent hook environment ownership', () => {
  it.each([
    { agentId: 'CLAUDE_SESSION_ID' },
    { agentType: 'CLAUDE_PROJECT_DIR' },
    { agentId: 'SAME', agentType: 'SAME' },
    { agentId: 'INVALID=NAME' },
  ])('rejects an invalid host alias at runtime assembly: %j', (names) => {
    expect(() => buildAgentRuntime({
      config: { hooks },
      subagentHookEnvironmentNames: names,
    } as unknown as ICreateSessionOptions, 'session-1', '/tmp/project', undefined as never, [], [])).toThrow(
      /subagent hook environment/i,
    );
  });

  it('omits product env aliases for a neutral host', async () => {
    const input = await captureHookInput();
    expect(input.agent_id).toBe('agent-1');
    expect(input.agent_type).toBe('research');
    expect(input.env).not.toHaveProperty('ROBOTA_AGENT_ID');
    expect(input.env).not.toHaveProperty('ROBOTA_AGENT_TYPE');
  });

  it('injects only the host-selected aliases for a product host', async () => {
    const input = await captureHookInput({ agentId: 'ATLAS_AGENT_ID', agentType: 'ATLAS_AGENT_TYPE' });
    expect(input.env).toMatchObject({
      ATLAS_AGENT_ID: 'agent-1', ATLAS_AGENT_TYPE: 'research',
    });
    expect(input.env).not.toHaveProperty('ROBOTA_AGENT_ID');
  });

  it('carries host aliases through runtime assembly into a real task lifecycle hook', async () => {
    let resolveInput!: (input: IHookInput) => void;
    const seenInput = new Promise<IHookInput>((resolve) => { resolveInput = resolve; });
    const executor: IHookTypeExecutor = {
      type: 'command',
      execute: async (_definition, input) => {
        resolveInput(input);
        return { outcome: 'allow', source: 'command', stdout: '' };
      },
    };
    const runner: IBackgroundTaskRunner = {
      kind: 'agent',
      start: (task) => ({
        taskId: task.taskId,
        result: Promise.resolve({ taskId: task.taskId, kind: 'agent', output: 'done' }),
        cancel: async () => undefined,
      }),
    };
    const options = {
      config: { hooks },
      backgroundTaskRunners: [runner],
      subagentHookEnvironmentNames: { agentId: 'ACME_AGENT_ID' },
    } as unknown as ICreateSessionOptions;
    const runtime = buildAgentRuntime(options, 'session-1', '/tmp/project', undefined as never, [], [executor]);
    const task = await runtime.backgroundTaskManager.spawn({
      kind: 'agent', label: 'research', agentType: 'research', prompt: 'inspect',
      parentSessionId: 'session-1', mode: 'foreground', depth: 1, cwd: '/tmp/project',
      permissionPolicy: 'inherit-allowlist',
    });
    const input = await seenInput;
    expect(input.env).toHaveProperty('ACME_AGENT_ID', task.id);
    expect(input.env).not.toHaveProperty('ROBOTA_AGENT_ID');
    await runtime.backgroundTaskManager.wait(task.id);
  });
});
