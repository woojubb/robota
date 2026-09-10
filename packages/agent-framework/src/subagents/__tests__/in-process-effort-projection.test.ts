import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createSubagentSession: vi.fn() }));

vi.mock('../../assembly/create-subagent-session.js', () => ({
  createSubagentSession: mocks.createSubagentSession,
}));

import { createInProcessSubagentRunner } from '../in-process-subagent-runner.js';

import type { IInProcessSubagentRunnerDeps } from '../in-process-subagent-runner.js';
import type { IAgentDefinition } from '../../agents/agent-definition-types.js';
import type { IResolvedConfig } from '../../config/config-types.js';
import type { ISubagentJobStart } from '@robota-sdk/agent-executor';

const DEFINITION: IAgentDefinition = {
  name: 'worker',
  description: 'Worker',
  systemPrompt: 'Work',
  effort: 'medium',
};

function deps(): IInProcessSubagentRunnerDeps {
  return {
    config: { provider: {}, hooks: undefined } as unknown as IResolvedConfig,
    context: {},
    tools: [],
    terminal: { write: vi.fn(), writeError: vi.fn() },
    provider: {},
    customAgentRegistry: () => DEFINITION,
  } as unknown as IInProcessSubagentRunnerDeps;
}

function job(effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max'): ISubagentJobStart {
  return {
    taskId: 'task_1',
    request: {
      agentType: 'worker',
      prompt: 'Do work',
      parentSessionId: 'parent',
      depth: 1,
      cwd: '/workspace',
      permissionPolicy: 'inherit-allowlist',
      ...(effort !== undefined ? { effort } : {}),
    },
  } as ISubagentJobStart;
}

describe('in-process subagent effort projection (BEHAVIOR-009)', () => {
  it('uses the request effort when present and the definition effort otherwise', () => {
    const session = {
      run: vi.fn().mockResolvedValue('done'),
      abort: vi.fn(),
      getFullHistory: vi.fn().mockReturnValue([]),
    };
    mocks.createSubagentSession.mockReturnValue(session);
    const runner = createInProcessSubagentRunner(deps());

    runner.start(job('high'));
    expect(mocks.createSubagentSession).toHaveBeenLastCalledWith(
      expect.objectContaining({
        agentDefinition: expect.objectContaining({ effort: 'high' }),
      }),
    );

    runner.start(job());
    expect(mocks.createSubagentSession).toHaveBeenLastCalledWith(
      expect.objectContaining({
        agentDefinition: expect.objectContaining({ effort: 'medium' }),
      }),
    );
  });
});
