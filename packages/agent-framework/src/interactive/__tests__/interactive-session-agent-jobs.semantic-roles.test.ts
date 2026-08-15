import { describe, expect, it, vi } from 'vitest';

import { storeAgentToolDeps } from '../../tools/agent-tool.js';
import { spawnAgentJobFromSession } from '../interactive-session-agent-jobs.js';

import type { Session } from '@robota-sdk/agent-session';

describe('agent job semantic-role provenance', () => {
  it('records an alternate semantic spawn-command id', async () => {
    const spawn = vi.fn().mockResolvedValue({ id: 'job-1' });
    const session = { getSessionId: () => 'session-1' } as unknown as Session;
    storeAgentToolDeps(session, {
      backgroundTaskManager: {},
      subagentManager: { spawn },
      customAgentRegistry: () => ({
        name: 'worker',
        description: 'Worker',
        systemPrompt: 'Work',
      }),
    } as never);

    await spawnAgentJobFromSession(
      session,
      { agentType: 'worker', label: 'Worker', mode: 'background', prompt: 'Do work' },
      '/workspace',
      'model',
      'spawn-subagent-alt',
    );

    expect(spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          executionOriginCommandName: 'spawn-subagent-alt',
        }),
      }),
    );
  });
});
