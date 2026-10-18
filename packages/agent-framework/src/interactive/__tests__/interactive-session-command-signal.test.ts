/**
 * A command's caller can cancel the turn a skill starts. Until the skill submits its turn there is
 * nothing for `abort()` to reach, so the caller's signal is what stops the skill's preparation and
 * refuses the turn it would have submitted.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createNodeHostContributionSourcesFixture } from '../../testing/contribution-source-fixture.js';
import { createTrustedProjectAccessFixture } from '../../testing/trusted-project-state-fixture.js';
import { InteractiveSession } from '../interactive-session.js';

import type { ICommandHostContext, ICommandModule } from '../../commands/index.js';

function mockSession(cwd: string) {
  return {
    getCwd: vi.fn().mockReturnValue(cwd),
    run: vi.fn().mockResolvedValue('skill answer'),
    abort: vi.fn(),
    getHistory: vi.fn().mockReturnValue([]),
    getContextState: vi.fn().mockReturnValue({ usedPercentage: 1, usedTokens: 1, maxTokens: 1000 }),
    injectMessage: vi.fn(),
    getSessionId: vi.fn().mockReturnValue('session-1'),
    getModelId: vi.fn().mockReturnValue('m'),
    getProviderId: vi.fn().mockReturnValue('p'),
    getPermissionMode: vi.fn().mockReturnValue('default'),
    getEventService: vi.fn().mockReturnValue({ subscribe: vi.fn(), unsubscribe: vi.fn() }),
    getSystemMessage: vi.fn().mockReturnValue('# system'),
    getToolSchemas: vi.fn().mockReturnValue([]),
  };
}

/** The same routing the product's `/skills <name>` command performs. */
const skillsModule: ICommandModule = {
  name: 'skills-test',
  systemCommands: [
    {
      name: 'skills',
      description: 'run a skill',
      execute: async (context: ICommandHostContext, args: string) => {
        const displayInput = `/${args}`;
        return (
          (await context.executeSkillCommandByName(args, '', {
            invocationSource: context.getCommandInvocationSource(),
            displayInput,
            rawInput: displayInput,
          })) ?? { success: false, message: 'unknown skill' }
        );
      },
    },
  ],
} as unknown as ICommandModule;

describe('a command cancelled before its skill submits a turn', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  async function build() {
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'agent-command-signal-')));
    dirs.push(cwd);
    const skillDir = join(cwd, '.agents', 'skills', 'audit');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\nname: audit\ndescription: Audit\n---\nAudit the code',
      'utf8',
    );
    const inner = mockSession(cwd);
    const session = new InteractiveSession({
      session: inner as never,
      cwd,
      contributionSources: createNodeHostContributionSourcesFixture(cwd),
      skillRoots: [{ root: join('.agents', 'skills'), kind: 'skills' as const }],
      projectAccess: await createTrustedProjectAccessFixture(cwd),
      commandModules: [skillsModule],
    });
    return { session, run: inner.run };
  }

  /** Abort `controller` when the skill reaches `status`, the way an editor's cancel lands mid-command. */
  function abortAt(session: InteractiveSession, status: string, controller: AbortController) {
    session.on('skill_activation', (event: { status?: string }) => {
      if (event.status === status) controller.abort();
    });
  }

  it('runs no turn when the cancel lands while the skill is being prepared', async () => {
    const { session, run } = await build();
    const controller = new AbortController();
    abortAt(session, 'started', controller);
    await expect(
      session.executeCommand('skills', 'audit', 'remote', undefined, undefined, {
        signal: controller.signal,
      }),
    ).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });

  it('runs no turn when the cancel lands after preparation, before the turn starts', async () => {
    const { session, run } = await build();
    const controller = new AbortController();
    abortAt(session, 'completed', controller);
    await session.executeCommand('skills', 'audit', 'remote', undefined, undefined, {
      signal: controller.signal,
    });
    expect(run).not.toHaveBeenCalled();
  });

  it('runs no turn for a command whose signal was already cancelled', async () => {
    const { session, run } = await build();
    await expect(
      session.executeCommand('skills', 'audit', 'remote', undefined, undefined, {
        signal: AbortSignal.abort(),
      }),
    ).rejects.toThrow();
    expect(run).not.toHaveBeenCalled();
  });

  it('still runs the skill turn when its signal is never cancelled', async () => {
    const { session, run } = await build();
    await session.executeCommand('skills', 'audit', 'remote', undefined, undefined, {
      signal: new AbortController().signal,
    });
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    expect(run.mock.calls[0]![0]).toContain('Audit the code');
  });
});
