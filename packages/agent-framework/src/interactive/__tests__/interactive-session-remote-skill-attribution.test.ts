/**
 * A skill a remote co-driver runs is that driver's turn, attributed exactly as its direct prompts
 * are: never recorded as the owner's prompt history, never exported as the owner's content.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createNodeHostContributionSourcesFixture } from '../../testing/contribution-source-fixture.js';
import { createTrustedProjectAccessFixture } from '../../testing/trusted-project-state-fixture.js';
import { InteractiveSession } from '../interactive-session.js';

import type { ICommandHostContext, ICommandModule } from '../../commands/index.js';
import type { ILivePromptContentBatch } from '@robota-sdk/agent-interface-analytics';
import type { IPromptHistoryEntry } from '@robota-sdk/agent-interface-session';

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

let releaseHold: () => void = () => undefined;

/** The same routing the product's `/skills <name>` command performs, plus an owner command that stays open. */
const skillsModule: ICommandModule = {
  name: 'skills-test',
  systemCommands: [{
    name: 'hold',
    description: 'an owner command still running while another command runs',
    execute: () => new Promise((resolve) => {
      releaseHold = () => resolve({ success: true, message: 'held' });
    }),
  }, {
    name: 'skills',
    description: 'run a skill',
    execute: async (context: ICommandHostContext, args: string) => {
      const displayInput = `/${args}`;
      return (await context.executeSkillCommandByName(args, '', {
        invocationSource: context.getCommandInvocationSource(),
        displayInput,
        rawInput: displayInput,
      })) ?? { success: false, message: 'unknown skill' };
    },
  }],
} as unknown as ICommandModule;

describe('remote skill attribution', () => {
  const dirs: string[] = [];
  afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

  async function build() {
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'robota-remote-skill-')));
    dirs.push(cwd);
    const skillDir = join(cwd, '.agents', 'skills', 'audit');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(join(skillDir, 'SKILL.md'), '---\nname: audit\ndescription: Audit\n---\nAudit the code', 'utf8');
    const contents: ILivePromptContentBatch[] = [];
    const history: IPromptHistoryEntry[] = [];
    const traces = vi.fn();
    const session = new InteractiveSession({
      session: mockSession(cwd) as never,
      cwd,
      contributionSources: createNodeHostContributionSourcesFixture(cwd),
      skillRoots: [{ root: join('.agents', 'skills'), kind: 'skills' as const }],
      projectAccess: await createTrustedProjectAccessFixture(cwd),
      commandModules: [skillsModule],
      promptHistory: { writer: { append: (entry) => void history.push(entry) }, project: cwd },
      livePromptTrace: {
        enqueue: traces,
        content: {
          policy: { userPrompts: true, assistantResponses: true, maxBytes: 2048 },
          enqueue: (batch) => void contents.push(batch),
        },
      },
    });
    return { session, contents, history, traces };
  }

  it('neither records nor exports a remote co-driver’s skill turn as the owner’s', async () => {
    const { session, contents, history, traces } = await build();
    await session.executeCommand('skills', 'audit', 'remote', 'device-42');
    // The trace batch is enqueued in the same step a content batch would be.
    await vi.waitFor(() => expect(traces).toHaveBeenCalledTimes(1));
    expect(history).toEqual([]);
    expect(contents).toEqual([]);
  });

  it('still records and exports the owner’s own skill turn', async () => {
    const { session, contents, history } = await build();
    await session.executeCommand('skills', 'audit', 'user');
    await vi.waitFor(() => expect(contents).toHaveLength(1));
    expect(history.map((entry) => entry.text)).toEqual(['/audit']);
    expect(contents[0]!.items.map((item) => [item.kind, item.text])).toEqual([
      ['user-prompt', '/audit'],
      ['assistant-response', 'skill answer'],
    ]);
  });

  it('keeps a remote skill the co-driver’s when an owner command runs while it is being prepared', async () => {
    const { session, contents, history, traces } = await build();
    let held: Promise<unknown> | undefined;
    session.on('skill_activation', (event: { status?: string }) => {
      // The skill has started resolving; an owner command starts before its prompt is submitted.
      if (event.status === 'started' && held === undefined) held = session.executeCommand('hold', '', 'user');
    });
    await session.executeCommand('skills', 'audit', 'remote', 'device-42');
    await vi.waitFor(() => expect(traces).toHaveBeenCalledTimes(1));
    expect(held).toBeDefined();
    releaseHold();
    await held;
    expect(history).toEqual([]);
    expect(contents).toEqual([]);
    // Nothing is left behind: outside any command the source is the owner's, and the owner's next skill is theirs.
    expect(session.getCommandInvocationSource()).toBe('user');
    await session.executeCommand('skills', 'audit', 'user');
    await vi.waitFor(() => expect(contents).toHaveLength(1));
    expect(history.map((entry) => entry.text)).toEqual(['/audit']);
  });
});
