import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { InteractiveSession } from '../interactive-session.js';
import { createNodeHostContributionSourcesFixture } from '../../testing/contribution-source-fixture.js';
import { createTrustedProjectAccessFixture } from '../../testing/trusted-project-state-fixture.js';

import type { ICommandHostContext, ICommandModule } from '../../command-api/index.js';

/** The routing the product's `/skills <name>` command performs. */
const skillsModule = {
  name: 'skills-test',
  systemCommands: [
    {
      name: 'skills',
      description: 'run a skill',
      // Lets a typed `/<skill>` route here, as the product's `/skills` command does.
      semanticRole: 'skillActivation',
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

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'robota-plugin-skill-')));
  roots.push(root);
  return root;
}

function writeSkill(dir: string, name: string, body: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    ['---', `name: ${name}`, `description: ${name} skill`, '---', body].join('\n'),
  );
}

/** A user plugins folder holding the `helper` plugin with a skill, `tidy`, and a command, `lint`. */
function installHelperPlugin(home: string): string {
  const pluginsDir = join(home, 'plugins');
  const pluginDir = join(pluginsDir, 'cache', 'local', 'helper', '1.0.0');
  mkdirSync(join(pluginDir, '.claude-plugin'), { recursive: true });
  writeFileSync(
    join(pluginDir, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'helper', version: '1.0.0', description: 'Helper' }),
  );
  writeSkill(join(pluginDir, 'skills', 'tidy'), 'tidy', 'Tidy from the plugin.');
  mkdirSync(join(pluginDir, 'commands'), { recursive: true });
  writeFileSync(join(pluginDir, 'commands', 'lint.md'), '---\ndescription: Lint\n---\nLint it.');
  return pluginsDir;
}

async function sessionWith(options: {
  cwd: string;
  home: string;
  pluginsDir: string;
  enabledPlugins?: Record<string, boolean>;
  bare?: boolean;
}): Promise<{ session: InteractiveSession; run: ReturnType<typeof vi.fn> }> {
  const settingsPath = join(options.home, 'settings.json');
  writeFileSync(settingsPath, JSON.stringify({ enabledPlugins: options.enabledPlugins ?? {} }));
  const run = vi.fn().mockResolvedValue('done');
  const session = new InteractiveSession({
    session: {
      getCwd: () => options.cwd,
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
    cwd: options.cwd,
    contributionSources: createNodeHostContributionSourcesFixture(options.cwd),
    skillRoots: [{ root: join('.agents', 'skills'), kind: 'skills' as const }],
    projectAccess: await createTrustedProjectAccessFixture(options.cwd),
    commandModules: [skillsModule],
    pluginDirectories: { user: options.pluginsDir },
    userSettingsSources: [
      { kind: 'host', scope: 'user', displayName: 'user settings', path: settingsPath },
    ],
    ...(options.bare === true ? { bare: true } : {}),
  });
  return { session, run };
}

describe('a bundle plugin skill', () => {
  it('runs when the user types it', async () => {
    const home = tempRoot();
    const { session, run } = await sessionWith({
      cwd: tempRoot(),
      home,
      pluginsDir: installHelperPlugin(home),
    });

    const result = await session.executeCommand('tidy', '', 'user');

    expect(result).not.toBeNull();
    await vi.waitFor(() => expect(run).toHaveBeenCalled());
    expect(String(run.mock.calls[0]?.[0])).toContain('Tidy from the plugin.');
  });

  it('runs as `/<plugin>:<command>` when it is a plugin command', async () => {
    const home = tempRoot();
    const { session, run } = await sessionWith({
      cwd: tempRoot(),
      home,
      pluginsDir: installHelperPlugin(home),
    });

    await session.executeCommand('helper:lint', '', 'user');

    await vi.waitFor(() => expect(run).toHaveBeenCalled());
    expect(String(run.mock.calls[0]?.[0])).toContain('Lint it.');
  });

  it('runs when the model activates it', async () => {
    const home = tempRoot();
    const { session } = await sessionWith({
      cwd: tempRoot(),
      home,
      pluginsDir: installHelperPlugin(home),
    });

    const result = await session.executeSkillCommandByName('tidy', '', {
      invocationSource: 'model',
      displayInput: '/tidy',
      rawInput: '/tidy',
    });

    expect(result).toMatchObject({ success: true });
  });

  it('is listed with the session’s skills', async () => {
    const home = tempRoot();
    const { session } = await sessionWith({
      cwd: tempRoot(),
      home,
      pluginsDir: installHelperPlugin(home),
    });

    expect(session.listSkills().map((skill) => skill.name)).toContain('tidy');
  });

  it('is not reachable once its plugin is disabled', async () => {
    const home = tempRoot();
    const { session } = await sessionWith({
      cwd: tempRoot(),
      home,
      pluginsDir: installHelperPlugin(home),
      enabledPlugins: { helper: false },
    });

    expect(await session.executeCommand('tidy', '', 'user')).toBeNull();
  });

  it('is not loaded by a bare session', async () => {
    const home = tempRoot();
    const { session } = await sessionWith({
      cwd: tempRoot(),
      home,
      pluginsDir: installHelperPlugin(home),
      bare: true,
    });

    expect(await session.executeCommand('tidy', '', 'user')).toBeNull();
  });

  it('gives way to the session’s own skill of the same name', async () => {
    const home = tempRoot();
    const cwd = tempRoot();
    writeSkill(join(cwd, '.agents', 'skills', 'tidy'), 'tidy', 'Tidy from the project.');
    const { session, run } = await sessionWith({
      cwd,
      home,
      pluginsDir: installHelperPlugin(home),
    });

    await session.executeCommand('tidy', '', 'user');

    await vi.waitFor(() => expect(run).toHaveBeenCalled());
    expect(String(run.mock.calls[0]?.[0])).toContain('Tidy from the project.');
  });
});
