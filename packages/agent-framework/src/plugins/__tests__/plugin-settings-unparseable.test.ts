/**
 * A settings file that does not parse must not read as "no plugin is disabled", and a plugin
 * command must not overwrite the user's whole settings file because of it.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadHostBundlePluginsFromScopes } from '../host-bundle-plugin-loader.js';
import { NodeHostPluginSettingsStore } from '../plugin-settings-store.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'agent-plugin-settings-'));
  roots.push(root);
  return root;
}

/** A plugins folder holding one plugin, `helper`, with one skill. */
function installHelper(root: string): string {
  const pluginsDir = join(root, 'plugins');
  const pluginDir = join(pluginsDir, 'cache', 'local', 'helper', '1.0.0');
  mkdirSync(join(pluginDir, '.claude-plugin'), { recursive: true });
  writeFileSync(
    join(pluginDir, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'helper', version: '1.0.0', description: 'Helper' }),
  );
  mkdirSync(join(pluginDir, 'skills', 'tidy'), { recursive: true });
  writeFileSync(
    join(pluginDir, 'skills', 'tidy', 'SKILL.md'),
    '---\nname: tidy\ndescription: Tidy\n---\nTidy.',
  );
  return pluginsDir;
}

const UNPARSEABLE = '{ "model": "keep-me", "enabledPlugins": { "helper": false }, }';

describe('an unparseable plugin settings file', () => {
  it('loads no plugin, rather than every plugin the user disabled', () => {
    const root = tempRoot();
    const pluginsDir = installHelper(root);
    const settingsPath = join(root, 'settings.json');
    writeFileSync(settingsPath, UNPARSEABLE);

    expect(() => loadHostBundlePluginsFromScopes([pluginsDir], { settingsPath })).toThrow(
      /not valid JSON/,
    );
  });

  it('is left as it is by a plugin command, which fails instead', () => {
    const root = tempRoot();
    const settingsPath = join(root, 'settings.json');
    writeFileSync(settingsPath, UNPARSEABLE);
    const store = new NodeHostPluginSettingsStore(settingsPath);

    expect(() => store.setPluginEnabled('helper', true)).toThrow(/not valid JSON/);
    expect(readFileSync(settingsPath, 'utf8')).toBe(UNPARSEABLE);
  });

  it('still reads a missing file as nothing disabled', () => {
    const root = tempRoot();
    const store = new NodeHostPluginSettingsStore(join(root, 'settings.json'));

    expect(store.getEnabledPlugins()).toEqual({});
  });
});
