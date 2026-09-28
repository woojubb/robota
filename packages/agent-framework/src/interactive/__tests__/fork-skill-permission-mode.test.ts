import { describe, expect, it, vi } from 'vitest';

import { storeAgentToolDeps } from '../../tools/agent-tool.js';
import { runSkillInFork } from '../interactive-session-fork.js';

import type { IAgentToolDeps } from '../../tools/agent-tool.js';
import type { Session } from '@robota-sdk/agent-session';

const mocks = vi.hoisted(() => ({ createSubagentSession: vi.fn() }));

vi.mock('../../assembly/create-subagent-session.js', () => ({
  createSubagentSession: mocks.createSubagentSession,
}));

describe('a fork-context skill', () => {
  it('runs in the mode the parent is in now, not the one the runtime was built with', async () => {
    mocks.createSubagentSession.mockReturnValue({ run: vi.fn().mockResolvedValue('done') });
    const parent = {
      getPermissionMode: () => 'plan',
      getCwd: () => '/w',
      getModelEffort: () => 'auto',
    } as unknown as Session;
    storeAgentToolDeps(parent, {
      config: { provider: {}, permissions: { allow: [], deny: [] } },
      context: { agentsMd: '', projectNotesMd: '' },
      tools: [],
      terminal: {},
      provider: {},
      permissionMode: 'default',
      customAgentRegistry: () => ({ name: 'general-purpose', description: 'd', systemPrompt: 's' }),
    } as unknown as IAgentToolDeps);

    await runSkillInFork('do it', {}, parent);

    expect(mocks.createSubagentSession).toHaveBeenCalledWith(
      expect.objectContaining({ permissionMode: 'plan' }),
    );
  });
});
