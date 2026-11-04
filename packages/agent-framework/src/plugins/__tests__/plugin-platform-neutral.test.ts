/**
 * The plugin code is platform-neutral: it reads and writes only through the `fs` it is handed, spells
 * its paths from the text of the root it is given, and reports a warning through a callback instead
 * of writing to a stream. Run here over an in-memory file system and Windows-spelled roots, so none
 * of it can lean on the platform the tests run on.
 */

import { setGlobalLoggerSink } from '@robota-sdk/agent-core';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BundlePluginInstaller } from '../bundle-plugin-installer.js';
import { BundlePluginLoader } from '../bundle-plugin-loader.js';
import { createHostBundlePluginLoader } from '../host-bundle-plugin-loader.js';
import { MarketplaceClient } from '../marketplace-client.js';
import { NodeHostPluginSettingsStore } from '../plugin-settings-store.js';
import { MemoryFileSystem } from './memory-file-system.js';

import type { ILogger } from '@robota-sdk/agent-core';
import type { TExecFn } from '../marketplace-types.js';

const ROOTS = [
  { label: 'a Windows root', root: 'C:\\Users\\me\\.agent\\plugins', separator: '\\' },
  { label: 'a POSIX root', root: '/home/me/.agent/plugins', separator: '/' },
] as const;

function at(root: string, separator: string, ...segments: string[]): string {
  return [root, ...segments].join(separator);
}

function seedPlugin(fs: MemoryFileSystem, root: string, separator: string): string {
  const pluginDir = at(root, separator, 'cache', 'market', 'pilot', '1.0.0');
  fs.seed(
    at(pluginDir, separator, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'pilot', version: '1.0.0' }),
  );
  fs.seed(
    at(pluginDir, separator, 'skills', 'greet', 'SKILL.md'),
    '---\ndescription: Greets\n---\nSay hello.\n',
  );
  return pluginDir;
}

afterEach(() => {
  setGlobalLoggerSink(undefined);
  vi.restoreAllMocks();
});

describe.each(ROOTS)('the plugin loader over $label', ({ root, separator }) => {
  it('loads a plugin selected by its installed record, spelling every path from the root', () => {
    const fs = new MemoryFileSystem();
    const pluginDir = seedPlugin(fs, root, separator);
    fs.seed(
      at(root, separator, 'installed_plugins.json'),
      JSON.stringify({
        'pilot@market': {
          pluginName: 'pilot',
          marketplace: 'market',
          version: '1.0.0',
          installPath: pluginDir,
          installedAt: 'fixture',
        },
      }),
    );

    const [plugin] = new BundlePluginLoader(root, undefined, fs).loadPluginsSync();

    expect(plugin?.manifest.name).toBe('pilot');
    expect(plugin?.pluginDir).toBe(pluginDir);
    expect(plugin?.skills[0]).toMatchObject({
      name: 'greet',
      skillDirectory: at(pluginDir, separator, 'skills', 'greet'),
    });
  });

  it('refuses a record whose install path is not the cached revision', () => {
    const fs = new MemoryFileSystem();
    const pluginDir = seedPlugin(fs, root, separator);
    fs.seed(
      at(root, separator, 'installed_plugins.json'),
      JSON.stringify({
        'pilot@market': {
          pluginName: 'pilot',
          marketplace: 'market',
          version: '1.0.0',
          // A relative path would be anchored to the process directory, which is not read here.
          installPath: pluginDir.slice(root.length + 1),
          installedAt: 'fixture',
        },
      }),
    );

    const inspection = new BundlePluginLoader(root, undefined, fs).inspectPluginsSync();

    expect(inspection.loaded).toHaveLength(0);
    expect(inspection.skipped.map((skip) => skip.reason)).toEqual(['revision-unselected']);
  });

  it('reads the enabled plugins through the same file system, and refuses a plugin the user disabled', () => {
    const fs = new MemoryFileSystem();
    seedPlugin(fs, root, separator);
    const settingsPath = at(root, separator, '..', 'settings.json');
    fs.seed(settingsPath, JSON.stringify({ enabledPlugins: { 'pilot@market': false } }));

    const loader = createHostBundlePluginLoader({ pluginsDir: root, settingsPath, fs });

    expect(loader.loadPluginsSync()).toHaveLength(0);
  });

  it('writes its settings through the file system it was given', () => {
    const fs = new MemoryFileSystem();
    const settingsPath = at(root, separator, '..', 'config', 'settings.json');
    new NodeHostPluginSettingsStore(settingsPath, fs).setPluginEnabled('pilot@market', true);

    expect(JSON.parse(fs.readFileSync(settingsPath))).toEqual({
      enabledPlugins: { 'pilot@market': true },
    });
  });
});

describe('a plugin component without a file system', () => {
  it.each([
    ['BundlePluginLoader', () => new BundlePluginLoader('/p', undefined, undefined as never)],
    [
      'NodeHostPluginSettingsStore',
      () => new NodeHostPluginSettingsStore('/s.json', undefined as never),
    ],
    [
      'MarketplaceClient',
      () => new MarketplaceClient({ pluginsDir: '/p', exec: (() => '') as TExecFn } as never),
    ],
    [
      'BundlePluginInstaller',
      () =>
        new BundlePluginInstaller({
          pluginsDir: '/p',
          settingsStore: {} as never,
          marketplaceClient: {} as never,
          exec: (() => '') as TExecFn,
        } as never),
    ],
  ])('%s refuses at construction and says what to pass', (name, construct) => {
    expect(construct).toThrow(new RegExp(`${name} requires \`fs\``));
    expect(construct).toThrow(/NodeFileSystem/);
  });
});

describe('a refused registry record', () => {
  const root = '/home/me/.agent/plugins';
  const tampered = {
    'pilot@market': {
      pluginName: 'pilot',
      marketplace: 'market',
      version: '1.0.0',
      installPath: '/home/me/.agent/settings.json',
      installedAt: 'fixture',
    },
  };

  function installerOver(fs: MemoryFileSystem, onWarning?: (message: string) => void) {
    fs.seed(`${root}/installed_plugins.json`, JSON.stringify(tampered));
    fs.seed('/home/me/.agent/settings.json', '{}');
    const settingsStore = new NodeHostPluginSettingsStore('/home/me/.agent/settings.json', fs);
    const exec = (() => '') as TExecFn;
    const marketplaceClient = new MarketplaceClient({ pluginsDir: root, exec, fs });
    return new BundlePluginInstaller({
      pluginsDir: root,
      settingsStore,
      marketplaceClient,
      exec,
      fs,
      ...(onWarning === undefined ? {} : { onWarning }),
    });
  }

  it('is reported to the onWarning callback, and the file it named is left alone', async () => {
    const fs = new MemoryFileSystem();
    const onWarning = vi.fn();
    await installerOver(fs, onWarning).uninstall('pilot@market');
    expect(onWarning).toHaveBeenCalledTimes(1);
    expect(onWarning.mock.calls[0]?.[0]).toMatch(/Refusing to remove a plugin directory/);
    expect(fs.existsSync('/home/me/.agent/settings.json')).toBe(true);
  });

  it('goes to the library logger when there is no callback, and never to the process streams', async () => {
    const lines: string[] = [];
    const sink = (...args: unknown[]): void => void lines.push(String(args[0]));
    setGlobalLoggerSink({
      debug: sink,
      info: sink,
      warn: sink,
      error: sink,
      log: sink,
    } satisfies ILogger);
    const stderr = vi.spyOn(process.stderr, 'write');
    await installerOver(new MemoryFileSystem()).uninstall('pilot@market');
    expect(lines.join('\n')).toMatch(/Refusing to remove a plugin directory/);
    expect(stderr).not.toHaveBeenCalled();
  });

  it('is reported by a marketplace removal the same way', () => {
    const fs = new MemoryFileSystem();
    fs.seed(`${root}/installed_plugins.json`, JSON.stringify(tampered));
    fs.seed('/home/me/.agent/settings.json', '{}');
    fs.seed(
      `${root}/known_marketplaces.json`,
      JSON.stringify({
        market: {
          source: { type: 'local', path: '/elsewhere' },
          installLocation: `${root}/marketplaces/market`,
          lastUpdated: 'fixture',
        },
      }),
    );
    fs.mkdirSync(`${root}/marketplaces/market`);
    const onWarning = vi.fn();
    new MarketplaceClient({
      pluginsDir: root,
      exec: (() => '') as TExecFn,
      fs,
      onWarning,
    }).removeMarketplace('market');
    expect(onWarning.mock.calls[0]?.[0]).toMatch(/Refusing to remove a plugin directory/);
    expect(fs.existsSync('/home/me/.agent/settings.json')).toBe(true);
    expect(JSON.parse(fs.readFileSync(`${root}/installed_plugins.json`))).toEqual({});
  });
});

describe('the revision a marketplace reports', () => {
  function clientWith(result: string | Uint8Array): MarketplaceClient {
    const fs = new MemoryFileSystem();
    const root = '/home/me/.agent/plugins';
    fs.seed(
      `${root}/known_marketplaces.json`,
      JSON.stringify({
        market: {
          source: { type: 'git', url: 'https://example.test/m.git' },
          installLocation: `${root}/marketplaces/market`,
          lastUpdated: 'fixture',
        },
      }),
    );
    return new MarketplaceClient({ pluginsDir: root, exec: (() => result) as TExecFn, fs });
  }

  it('reads the first twelve characters of what git printed, as text or as bytes', () => {
    const sha = '0123456789abcdef0123456789abcdef01234567\n';
    expect(clientWith(sha).getMarketplaceSha('market')).toBe('0123456789ab');
    expect(clientWith(new TextEncoder().encode(sha)).getMarketplaceSha('market')).toBe(
      '0123456789ab',
    );
  });
});
