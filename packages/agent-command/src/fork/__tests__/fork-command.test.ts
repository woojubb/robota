/**
 * CLI-1994 TC-07 — what `/fork` actually does to its host.
 *
 * The command is the only place the two halves of a fork meet: the session writes the COPY, and the
 * job that resumes it carries the copy's id and nothing else. What these cases pin is that pairing —
 * the copy is written exactly once, the job that follows names it, and a failure to write the copy
 * stops there rather than spawning a child that will look for a record nobody wrote.
 */

import { describe, expect, it, vi } from 'vitest';

import { executeForkCommand } from '../fork-command.js';

import type { ICommandHostAgentJobs, ICommandHostSessionAccess } from '@robota-sdk/agent-framework';
import type { ISubagentJobState } from '@robota-sdk/agent-interface-execution';

const FORK_SESSION_ID = 'session_cli-1994-fork';
const DEFAULT_FORK_NAME = 'parent-work (fork)';
const TASK_ID = 'agent_1';

const JOB_STATE = {
  id: TASK_ID,
  type: 'general-purpose',
  label: DEFAULT_FORK_NAME,
  parentSessionId: 'session_parent',
  status: 'running',
  mode: 'background',
  depth: 1,
  cwd: '/workspace',
  promptPreview: 'forked',
  updatedAt: '2026-09-07T00:00:00.000Z',
} as unknown as ISubagentJobState;

interface IForkHost {
  readonly context: ICommandHostSessionAccess & ICommandHostAgentJobs;
  readonly forkSession: ReturnType<typeof vi.fn>;
  readonly spawnAgentJob: ReturnType<typeof vi.fn>;
}

/** The two capabilities `/fork` reads, and nothing else the command never touches. */
function createForkHost(options?: {
  readonly forkSession?: ReturnType<typeof vi.fn>;
  readonly spawnAgentJob?: ReturnType<typeof vi.fn>;
  readonly withoutAgentJobs?: boolean;
}): IForkHost {
  const forkSession =
    options?.forkSession ??
    vi.fn().mockResolvedValue({ sessionId: FORK_SESSION_ID, name: DEFAULT_FORK_NAME });
  const spawnAgentJob = options?.spawnAgentJob ?? vi.fn().mockResolvedValue(JOB_STATE);
  const context = {
    forkSession,
    getAgentJobCapability: () =>
      options?.withoutAgentJobs === true ? undefined : { spawnAgentJob },
  } as unknown as ICommandHostSessionAccess & ICommandHostAgentJobs;
  return { context, forkSession, spawnAgentJob };
}

describe('/fork writes the copy and starts the job that resumes it (CLI-1994 TC-07)', () => {
  it('forks once, then spawns a background job carrying the returned id and a worktree', async () => {
    const host = createForkHost();

    const result = await executeForkCommand(host.context, '');

    expect(host.forkSession).toHaveBeenCalledTimes(1);
    expect(host.forkSession).toHaveBeenCalledWith({});
    expect(host.spawnAgentJob).toHaveBeenCalledTimes(1);
    expect(host.spawnAgentJob).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'background',
        isolation: 'worktree',
        resumeSessionId: FORK_SESSION_ID,
        label: DEFAULT_FORK_NAME,
      }),
    );
    // The conversation is NOT on the request — only the id it was written under.
    const request = host.spawnAgentJob.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Object.keys(request)).not.toContain('messages');
    expect(Object.keys(request)).not.toContain('seedMessages');
    // The operator is told both names they will need: the new session and the task.
    expect(result.success).toBe(true);
    expect(result.message).toContain(DEFAULT_FORK_NAME);
    expect(result.message).toContain(TASK_ID);
    expect(result.data).toEqual({
      sessionId: FORK_SESSION_ID,
      name: DEFAULT_FORK_NAME,
      taskId: TASK_ID,
    });
  });

  it('`/fork my-branch` passes the operator name through to the copy', async () => {
    const host = createForkHost({
      forkSession: vi.fn().mockResolvedValue({ sessionId: FORK_SESSION_ID, name: 'my-branch' }),
    });

    const result = await executeForkCommand(host.context, 'my-branch');

    expect(host.forkSession).toHaveBeenCalledWith({ name: 'my-branch' });
    expect(host.spawnAgentJob).toHaveBeenCalledWith(
      expect.objectContaining({ label: 'my-branch', resumeSessionId: FORK_SESSION_ID }),
    );
    expect(result.message).toContain('my-branch');
  });

  it('`/fork --same-dir` opts out of the worktree, and still names the copy by default', async () => {
    const host = createForkHost();

    const result = await executeForkCommand(host.context, '--same-dir');

    expect(host.forkSession).toHaveBeenCalledWith({});
    expect(host.spawnAgentJob).toHaveBeenCalledWith(expect.objectContaining({ isolation: 'none' }));
    expect(result.message).toContain('in this directory');
  });

  it('`/fork name --same-dir` reads as both — the flag is not part of the name', async () => {
    const host = createForkHost({
      forkSession: vi.fn().mockResolvedValue({ sessionId: FORK_SESSION_ID, name: 'experiment' }),
    });

    await executeForkCommand(host.context, 'experiment --same-dir');

    expect(host.forkSession).toHaveBeenCalledWith({ name: 'experiment' });
    expect(host.spawnAgentJob).toHaveBeenCalledWith(expect.objectContaining({ isolation: 'none' }));
  });

  it('a forkSession rejection is reported and NO job is spawned', async () => {
    const host = createForkHost({
      forkSession: vi.fn().mockRejectedValue(new Error('this session has no session store')),
    });

    const result = await executeForkCommand(host.context, '');

    expect(result.success).toBe(false);
    expect(result.message).toContain('this session has no session store');
    expect(host.spawnAgentJob).not.toHaveBeenCalled();
  });

  it('a spawn failure still names the written copy, so the operator can resume it by hand', async () => {
    const host = createForkHost({
      spawnAgentJob: vi.fn().mockRejectedValue(new Error('depth limit reached')),
    });

    const result = await executeForkCommand(host.context, '');

    expect(result.success).toBe(false);
    expect(result.message).toContain('depth limit reached');
    expect(result.message).toContain(FORK_SESSION_ID);
    expect(result.message).toContain('--resume');
  });

  it('a host with no agent runtime refuses before writing anything', async () => {
    const host = createForkHost({ withoutAgentJobs: true });

    const result = await executeForkCommand(host.context, '');

    expect(result.success).toBe(false);
    expect(result.message).toContain('cannot start background jobs');
    expect(host.forkSession).not.toHaveBeenCalled();
  });

  it('a mistyped flag is refused rather than becoming the session name', async () => {
    const host = createForkHost();

    const result = await executeForkCommand(host.context, '--same-dr');

    expect(result.success).toBe(false);
    expect(result.message).toContain('Unknown option: --same-dr');
    expect(host.forkSession).not.toHaveBeenCalled();
    expect(host.spawnAgentJob).not.toHaveBeenCalled();
  });
});
