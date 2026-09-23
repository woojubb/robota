import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createInteractiveSession } from '../interactive-session-init.js';
import { createNodeHostSettingsSource } from '../../config/settings-source.js';
import { TEST_PROJECT_SETTINGS_PATHS } from '../../testing/project-settings-path-fixture.js';
import { createTrustedProjectAccessFixture } from '../../testing/trusted-project-state-fixture.js';
import { createRestrictedWorkspaceProjectAccess } from '../../workspace-trust/index.js';

let root: string;
let cwd: string;
let home: string;
const originalHome = process.env.HOME;

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value), 'utf8');
}

function addPlugin(name: string, type: 'prompt' | 'agent'): string {
  const pluginDir = join(cwd, '.robota', 'plugins', 'cache', 'market', name, '1.0.0');
  writeJson(join(pluginDir, '.claude-plugin', 'plugin.json'), {
    name,
    version: '1.0.0',
    description: 'Hook source fixture',
    features: { hooks: true },
  });
  const hooksPath = join(pluginDir, 'hooks', 'hooks.json');
  writeJson(hooksPath, {
    PreToolUse: [{ matcher: '', hooks: [{ type, [type]: 'fixture' }] }],
  });
  return hooksPath;
}

async function start(): Promise<Error | undefined> {
  try {
    await createInteractiveSession({
      cwd,
      projectAccess: await createTrustedProjectAccessFixture(cwd),
      projectSettingsPaths: TEST_PROJECT_SETTINGS_PATHS,
      userSettingsSources: [
        createNodeHostSettingsSource('user', join(home, '.robota', 'settings.json')),
      ],
      provider: createScriptedProvider([]).provider,
      onTextDelta: () => {},
      onToolExecution: () => {},
    });
    return undefined;
  } catch (error) {
    if (error instanceof Error) return error;
    throw error;
  }
}

describe('startup hook diagnostics retain effective plugin sources', () => {
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'robota-plugin-hook-source-')));
    cwd = join(root, 'project');
    home = join(root, 'home');
    mkdirSync(cwd, { recursive: true });
    mkdirSync(home, { recursive: true });
    process.env.HOME = home;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    rmSync(root, { recursive: true, force: true });
  });

  it('names the hooks.json source when only an enabled plugin declares an unrunnable type', async () => {
    const hooksPath = addPlugin('plugin-only', 'prompt');
    const error = await start();
    expect(error?.message).toContain('"prompt"');
    expect(error?.message).toContain(hooksPath);
  });

  it('does not load project plugin hooks before workspace trust is granted', async () => {
    addPlugin('untrusted-project', 'prompt');

    await expect(
      createInteractiveSession({
        cwd,
        projectAccess: createRestrictedWorkspaceProjectAccess('untrusted', cwd),
        provider: createScriptedProvider([]).provider,
        onTextDelta: () => {},
        onToolExecution: () => {},
      }),
    ).resolves.toBeDefined();
  });

  it('does not admit plugins without a host-selected enablement source', async () => {
    addPlugin('no-host-settings', 'prompt');

    await expect(
      createInteractiveSession({
        cwd,
        projectAccess: await createTrustedProjectAccessFixture(cwd),
        projectSettingsPaths: TEST_PROJECT_SETTINGS_PATHS,
        provider: createScriptedProvider([]).provider,
        onTextDelta: () => {},
        onToolExecution: () => {},
      }),
    ).resolves.toBeDefined();
  });

  it('uses the supplied settings file for plugin enablement instead of HOME', async () => {
    addPlugin('custom-disabled', 'prompt');
    writeJson(join(home, '.robota', 'settings.json'), {
      enabledPlugins: { 'custom-disabled@market': true },
    });
    const customSettingsPath = join(home, 'custom-settings.json');
    writeJson(customSettingsPath, { enabledPlugins: { 'custom-disabled@market': false } });

    await expect(
      createInteractiveSession({
        cwd,
        projectAccess: await createTrustedProjectAccessFixture(cwd),
        projectSettingsPaths: TEST_PROJECT_SETTINGS_PATHS,
        userSettingsSources: [createNodeHostSettingsSource('user', customSettingsPath)],
        provider: createScriptedProvider([]).provider,
        onTextDelta: () => {},
        onToolExecution: () => {},
      }),
    ).resolves.toBeDefined();
  });

  it('names both settings and plugin sources for the same type, excluding disabled settings groups', async () => {
    const hooksPath = addPlugin('mixed', 'prompt');
    writeJson(join(home, '.robota', 'settings.json'), {
      disabledHooks: ['disabled-project-group'],
      hooks: { PreToolUse: [{ matcher: '', hooks: [{ type: 'prompt', prompt: 'user' }] }] },
    });
    writeJson(join(cwd, '.robota', 'settings.json'), {
      hooks: {
        PreToolUse: [
          {
            id: 'disabled-project-group',
            matcher: '',
            hooks: [{ type: 'agent', agent: 'disabled' }],
          },
        ],
      },
    });
    const error = await start();
    expect(error?.message).toContain(join(home, '.robota', 'settings.json'));
    expect(error?.message).toContain(hooksPath);
    expect(error?.message).not.toContain('"agent"');
  });

  it('does not include a disabled plugin in startup hook diagnostics', async () => {
    const disabledHooksPath = addPlugin('disabled', 'agent');
    const activeHooksPath = addPlugin('active', 'prompt');
    writeJson(join(home, '.robota', 'settings.json'), {
      enabledPlugins: { 'disabled@market': false },
    });
    const error = await start();
    expect(error?.message).toContain(activeHooksPath);
    expect(error?.message).not.toContain(disabledHooksPath);
    expect(error?.message).not.toContain('"agent"');
  });
});
