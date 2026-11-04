import { describe, expect, it } from 'vitest';

import { buildAgentRuntime } from '../build-runtime.js';

import type { ICreateSessionOptions } from '../create-session-types.js';

/**
 * A session takes the background task runners it is given; it never builds any from the host. A
 * session given none has no runner, and the manager refuses a task of any kind it has none for.
 */
describe('a session given no background task runners', () => {
  it.each([
    { name: 'without the agent runtime', agentRuntime: {} },
    {
      name: 'with the agent runtime',
      agentRuntime: {
        enableAgentRuntime: true,
        subagentRunnerFactory: () => ({ start: () => {} }),
      },
    },
  ])('refuses a process task $name', async ({ agentRuntime }) => {
    const options = {
      host: {},
      config: { hooks: {} },
      ...agentRuntime,
    } as unknown as ICreateSessionOptions;
    const { backgroundTaskManager } = buildAgentRuntime(
      options,
      'session-1',
      '/tmp/project',
      undefined as never,
      [],
      [],
    );

    await expect(
      backgroundTaskManager.spawn({
        kind: 'process',
        label: 'build',
        command: 'true',
        parentSessionId: 'session-1',
        mode: 'background',
        depth: 1,
        cwd: '/tmp/project',
      }),
    ).rejects.toThrow('No background task runner registered for kind: process');
  });
});
