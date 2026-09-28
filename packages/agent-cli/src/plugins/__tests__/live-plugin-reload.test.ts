import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { createPluginCommandModule, createSkillsCommandModule } from '@robota-sdk/agent-command';
import { createNodeHostContributionSource, InteractiveSession } from '@robota-sdk/agent-framework';
import { describe, expect, it, vi } from 'vitest';

import { createDefaultPluginCommandAdapter } from '../default-plugin-command-adapter.js';

describe('production plugin reload', () => {
  it('removes runnable skills and the model catalogue when the real adapter cannot parse settings', async () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'robota-live-plugin-reload-')));
    vi.stubEnv('HOME', home);
    const pluginsDir = join(home, '.robota', 'plugins');
    const pluginRoot = join(pluginsDir, 'cache', 'fixture', 'helper', '1.0.0');
    mkdirSync(join(pluginRoot, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(pluginRoot, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'helper', version: '1.0.0', description: 'fixture' }),
    );
    mkdirSync(join(pluginRoot, 'skills', 'tidy'), { recursive: true });
    writeFileSync(
      join(pluginRoot, 'skills', 'tidy', 'SKILL.md'),
      '---\nname: tidy\ndescription: tidy fixture\n---\nTidy.',
    );
    const settingsPath = join(home, '.robota', 'settings.json');
    writeFileSync(settingsPath, '{}');
    const session = new InteractiveSession({
      cwd: home,
      provider: createScriptedProvider([]).provider,
      contributionSources: [createNodeHostContributionSource(home)],
      pluginDirectories: { user: pluginsDir },
      userSettingsSources: [
        { kind: 'host', scope: 'user', displayName: 'settings', path: settingsPath },
      ],
      commandModules: [
        createPluginCommandModule(),
        createSkillsCommandModule({
          contributionSources: [createNodeHostContributionSource(home)],
        }),
      ],
      commandHostAdapters: { plugin: createDefaultPluginCommandAdapter(home) },
    });
    try {
      await session.whenInitialized();
      expect(session.listSkills().some((skill) => skill.name === 'tidy')).toBe(true);
      expect(session.getSession().getSystemMessage()).toContain('tidy fixture');
      writeFileSync(settingsPath, '{');
      const result = await session.executeCommand('reload-plugins', '', 'user');
      expect(result?.success).toBe(false);
      expect(result?.message).toContain('not valid JSON');
      expect(session.listSkills()).toEqual([]);
      expect(session.getSession().getSystemMessage()).not.toContain('tidy fixture');
      expect(
        await session.executeSkillCommandByName('tidy', '', { invocationSource: 'model' }),
      ).toBeNull();
      expect(await session.executeCommand('tidy', '', 'user')).toBeNull();
    } finally {
      await session.shutdown();
      vi.unstubAllEnvs();
      rmSync(home, { recursive: true, force: true });
    }
  });
});
