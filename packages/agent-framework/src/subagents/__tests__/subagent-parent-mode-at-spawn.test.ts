import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAgentRuntime } from '../../index.js';

import type { IInProcessSubagentRunnerDeps, InteractiveSession } from '../../index.js';

describe('a subagent takes the parent mode it starts under', () => {
  const sessions: InteractiveSession[] = [];
  const dirs: string[] = [];

  afterEach(async () => {
    await Promise.all(sessions.splice(0).map((session) => session.shutdown()));
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('the runtime hands the runner the mode the parent is in now', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'subagent-mode-'));
    dirs.push(cwd);
    let deps: IInProcessSubagentRunnerDeps | undefined;
    const runtime = createAgentRuntime({
      cwd,
      provider: createScriptedProvider([]).provider,
      commandModules: [{ name: 'needs-agents', sessionRequirements: ['agent-runtime'] }],
      subagentRunnerFactory: (received) => {
        deps = received;
        return { start: vi.fn() };
      },
    });
    const session = runtime.createSession({ permissionMode: 'default' });
    sessions.push(session);
    await session.whenInitialized();

    session.getSession().setPermissionMode('plan');

    expect(deps?.permissionMode).toBe('default');
    expect(deps?.getParentPermissionMode?.()).toBe('plan');
  });
});
