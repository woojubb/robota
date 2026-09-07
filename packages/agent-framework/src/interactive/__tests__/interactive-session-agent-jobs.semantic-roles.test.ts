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

  it('CLI-1994 TC-05: forwards resumeSessionId to the manager request, and omits the key when absent', async () => {
    const spawn = vi.fn().mockResolvedValue({ id: 'job-1' });
    const session = { getSessionId: () => 'session-1' } as unknown as Session;
    storeAgentToolDeps(session, {
      backgroundTaskManager: {},
      subagentManager: { spawn },
      customAgentRegistry: () => ({
        name: 'general-purpose',
        description: 'General',
        systemPrompt: 'Work',
      }),
    } as never);

    await spawnAgentJobFromSession(
      session,
      {
        agentType: 'general-purpose',
        label: 'experiment',
        mode: 'background',
        prompt: '',
        resumeSessionId: 'session_x',
      },
      '/workspace',
      'user',
      'agent',
    );
    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({ resumeSessionId: 'session_x' }));

    spawn.mockClear();
    await spawnAgentJobFromSession(
      session,
      { agentType: 'general-purpose', label: 'plain', mode: 'background', prompt: 'Do work' },
      '/workspace',
      'user',
      'agent',
    );
    const request = spawn.mock.calls[0]?.[0] as Record<string, unknown>;
    // Absent means absent — not `resumeSessionId: undefined` on a request that crosses a wire.
    expect(Object.keys(request)).not.toContain('resumeSessionId');
  });
});
