import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { executeSkill } from '../skill-executor.js';
import { createSkillExecutionPort } from '../skill-execution-port.js';
import { PluginCommandSource } from '../plugin-source.js';
import { BundlePluginLoader } from '../../plugins/bundle-plugin-loader.js';
import { createNodeHostContributionSource } from '../../contributions/node-host-contribution-source.js';
import { createContributionSourcesForProjectAccess } from '../../contributions/initial-contribution-sources.js';
import { createNodeHostContributionSourcesFixture } from '../../testing/contribution-source-fixture.js';
import { createTrustedProjectAccessFixture } from '../../testing/trusted-project-state-fixture.js';
import { InteractiveSession } from '../../interactive/interactive-session.js';

import type { ICommandHostContext, ICommandModule } from '../index.js';

/** The routing the product's `/skills <name>` command performs. */
const skillsModule = {
  name: 'skills-test',
  systemCommands: [
    {
      name: 'skills',
      description: 'run a skill',
      execute: async (context: ICommandHostContext, args: string) =>
        (await context.executeSkillCommandByName(args, '', {
          invocationSource: context.getCommandInvocationSource(),
          displayInput: `/${args}`,
          rawInput: `/${args}`,
        })) ?? { success: false, message: 'unknown skill' },
    },
  ],
} as unknown as ICommandModule;

const roots: string[] = [];

function tempRoot(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'robota-skill-dir-')));
  roots.push(root);
  return root;
}

function writeSkill(root: string, relativeDir: string, body: string): string {
  const dir = join(root, relativeDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    ['---', 'name: audit', 'description: Audit code', '---', body].join('\n'),
  );
  return dir;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('${CLAUDE_SKILL_DIR}', () => {
  it('expands to the directory of a skill found under a host root', async () => {
    const home = tempRoot();
    const skillDir = writeSkill(
      home,
      join('.robota', 'skills', 'audit'),
      'Run ${CLAUDE_SKILL_DIR}/check.sh',
    );
    const port = createSkillExecutionPort(
      [createNodeHostContributionSource(home)],
      [{ root: join('.robota', 'skills'), kind: 'skills' }],
    );
    const [skill] = port.loadCommands();

    expect(skill?.skillDirectory).toBe(skillDir);
    const result = await port.resolveSkill(skill!, '');
    expect(result.prompt).toContain(`Run ${skillDir}/check.sh`);
  });

  it('expands to the directory of a skill in a trusted project', async () => {
    const project = tempRoot();
    const skillDir = writeSkill(
      project,
      join('.agents', 'skills', 'audit'),
      'See ${CLAUDE_SKILL_DIR}',
    );
    const projectAccess = await createTrustedProjectAccessFixture(project);
    const sources = createContributionSourcesForProjectAccess(projectAccess, tempRoot());
    const port = createSkillExecutionPort(sources, [
      { root: join('.agents', 'skills'), kind: 'skills' },
    ]);
    const [skill] = port.loadCommands();

    expect(skill?.skillDirectory).toBe(skillDir);
    expect((await port.resolveSkill(skill!, '')).prompt).toContain(`See ${skillDir}`);
  });

  it('expands in the prompt a session sends when the skill runs', async () => {
    const cwd = tempRoot();
    const skillDir = writeSkill(
      cwd,
      join('.agents', 'skills', 'audit'),
      'Read ${CLAUDE_SKILL_DIR}/rules.md',
    );
    const run = vi.fn().mockResolvedValue('done');
    const session = new InteractiveSession({
      session: {
        getCwd: () => cwd,
        run,
        abort: vi.fn(),
        getHistory: () => [],
        getContextState: () => ({ usedPercentage: 1, usedTokens: 1, maxTokens: 1000 }),
        injectMessage: vi.fn(),
        getSessionId: () => 'session-1',
        getModelId: () => 'm',
        getProviderId: () => 'p',
        getPermissionMode: () => 'default',
        getEventService: () => ({ subscribe: vi.fn(), unsubscribe: vi.fn() }),
        getSystemMessage: () => '# system',
        getToolSchemas: () => [],
      } as never,
      cwd,
      contributionSources: createNodeHostContributionSourcesFixture(cwd),
      skillRoots: [{ root: join('.agents', 'skills'), kind: 'skills' as const }],
      projectAccess: await createTrustedProjectAccessFixture(cwd),
      commandModules: [skillsModule],
    });

    await session.executeCommand('skills', 'audit', 'user');

    await vi.waitFor(() => expect(run).toHaveBeenCalled());
    expect(String(run.mock.calls[0]?.[0])).toContain(`Read ${skillDir}/rules.md`);
  });

  it('is the commands folder for a legacy command file', () => {
    const home = tempRoot();
    const commandsDir = join(home, '.claude', 'commands');
    mkdirSync(commandsDir, { recursive: true });
    writeFileSync(join(commandsDir, 'review.md'), '---\ndescription: Review\n---\nReview it.');
    const port = createSkillExecutionPort(
      [createNodeHostContributionSource(home)],
      [{ root: join('.claude', 'commands'), kind: 'commands' }],
    );

    expect(port.loadCommands()[0]?.skillDirectory).toBe(commandsDir);
  });

  it('is the plugin folder for a bundle plugin skill and command', () => {
    const pluginsDir = tempRoot();
    const pluginDir = join(pluginsDir, 'cache', 'local', 'helper', '1.0.0');
    mkdirSync(join(pluginDir, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(pluginDir, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'helper', version: '1.0.0', description: 'Helper' }),
    );
    writeSkill(pluginDir, join('skills', 'audit'), 'Audit.');
    mkdirSync(join(pluginDir, 'commands'), { recursive: true });
    writeFileSync(join(pluginDir, 'commands', 'lint.md'), '---\ndescription: Lint\n---\nLint.');

    const commands = new PluginCommandSource(
      new BundlePluginLoader(pluginsDir).loadPluginsSync(),
    ).getCommands();

    expect(commands.find((c) => c.name === 'audit')?.skillDirectory).toBe(
      join(pluginDir, 'skills', 'audit'),
    );
    expect(commands.find((c) => c.name === 'helper:lint')?.skillDirectory).toBe(
      join(pluginDir, 'commands'),
    );
  });

  it("is in the environment of a skill's shell commands, where the shell expands it", async () => {
    const seen: Array<Readonly<Record<string, string>> | undefined> = [];
    const skill = {
      name: 'audit',
      description: 'Audit',
      source: 'skill' as const,
      context: 'inject',
      skillContent: 'Result: !`run ${CLAUDE_SKILL_DIR}/check.sh`',
    };

    await executeSkill(
      skill,
      '',
      { shellExec: (_command, env) => (seen.push(env), 'ok') },
      { sessionId: 's-1', skillDir: '/skills/audit' },
    );

    expect(seen).toEqual([{ CLAUDE_SKILL_DIR: '/skills/audit', CLAUDE_SESSION_ID: 's-1' }]);
  });

  it('never names a path outside the source root', () => {
    const source = createNodeHostContributionSource(tempRoot());
    expect(() => source.locate?.('../outside')).toThrow('Not a root-relative path');
    expect(() => source.locate?.('/etc')).toThrow('Not a root-relative path');
  });
});
