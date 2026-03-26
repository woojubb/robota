import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BundlePluginInstaller } from '../bundle-plugin-installer.js';
import { MarketplaceClient } from '../marketplace-client.js';
import { PluginSettingsStore } from '../plugin-settings-store.js';

const TMP_BASE = join(tmpdir(), 'robota-installer-test-' + process.pid);

function setupDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
}

describe('BundlePluginInstaller', () => {
  let pluginsDir: string;
  let settingsPath: string;
  let installer: BundlePluginInstaller;
  let marketplaceClient: MarketplaceClient;
  type ExecFn = (command: string, options: { timeout: number; stdio?: string }) => string | Buffer;
  let mockExec: Mock;

  beforeEach(() => {
    const runDir = join(TMP_BASE, 'run-' + Math.random().toString(36).slice(2));
    pluginsDir = join(runDir, 'plugins');
    settingsPath = join(runDir, 'settings.json');
    setupDir(pluginsDir);

    mockExec = vi.fn().mockReturnValue('');

    marketplaceClient = new MarketplaceClient({ pluginsDir, exec: mockExec as ExecFn });

    installer = new BundlePluginInstaller({
      pluginsDir,
      settingsStore: new PluginSettingsStore(settingsPath),
      marketplaceClient,
      exec: mockExec as ExecFn,
    });
  });

  afterEach(() => {
    if (existsSync(TMP_BASE)) {
      rmSync(TMP_BASE, { recursive: true, force: true });
    }
  });

  /**
   * Set up a registered marketplace with a manifest and plugin entry.
   * Returns the marketplace directory path.
   */
  function setupMarketplace(
    name: string,
    plugins: Array<{
      name: string;
      title: string;
      description: string;
      source: string | { type: 'github'; repo: string };
      tags: string[];
      version?: string;
    }>,
  ): string {
    const marketplaceDir = join(pluginsDir, 'marketplaces', name);
    setupDir(join(marketplaceDir, '.claude-plugin'));
    writeJson(join(marketplaceDir, '.claude-plugin', 'marketplace.json'), {
      name,
      version: '1.0',
      plugins,
    });
    writeJson(join(pluginsDir, 'known_marketplaces.json'), {
      [name]: {
        source: { type: 'github', repo: `owner/${name}` },
        installLocation: marketplaceDir,
        lastUpdated: '2026-01-01T00:00:00.000Z',
      },
    });
    return marketplaceDir;
  }

  describe('install', () => {
    it('should install a plugin from a relative path source', async () => {
      const marketplaceDir = setupMarketplace('test-market', [
        {
          name: 'my-plugin',
          title: 'My Plugin',
          description: 'Test plugin',
          source: './packages/my-plugin',
          tags: ['test'],
          version: '1.0.0',
        },
      ]);

      // Create the plugin source directory in the marketplace clone
      const pluginSourceDir = join(marketplaceDir, 'packages', 'my-plugin', '.claude-plugin');
      setupDir(pluginSourceDir);
      writeJson(join(pluginSourceDir, 'plugin.json'), {
        name: 'my-plugin',
        version: '1.0.0',
        description: 'Test plugin',
        features: {},
      });

      await installer.install('my-plugin', 'test-market');

      // Should be installed in cache/<marketplace>/<plugin>/<version>/
      const targetDir = join(pluginsDir, 'cache', 'test-market', 'my-plugin', '1.0.0');
      expect(existsSync(targetDir)).toBe(true);
      expect(existsSync(join(targetDir, '.claude-plugin', 'plugin.json'))).toBe(true);

      // Should be recorded in installed_plugins.json
      const registryPath = join(pluginsDir, 'installed_plugins.json');
      expect(existsSync(registryPath)).toBe(true);
      const registry = JSON.parse(readFileSync(registryPath, 'utf-8')) as Record<string, unknown>;
      expect(registry['my-plugin@test-market']).toBeDefined();
    });

    it('should install a plugin from a GitHub source', async () => {
      setupMarketplace('gh-market', [
        {
          name: 'gh-plugin',
          title: 'GH Plugin',
          description: 'From GitHub',
          source: { type: 'github', repo: 'user/gh-plugin' },
          tags: [],
          version: '2.0.0',
        },
      ]);

      // Mock exec for git clone
      mockExec.mockImplementation((cmd: string) => {
        if (cmd.includes('git clone') && cmd.includes('user/gh-plugin')) {
          // The installer removes the pre-created dir and clones
          const parts = cmd.split(' ');
          const targetDir = parts[parts.length - 1];
          setupDir(targetDir);
        }
        return '';
      });

      await installer.install('gh-plugin', 'gh-market');

      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('git clone --depth 1'),
        expect.objectContaining({ timeout: expect.any(Number) }),
      );
      const cloneCmd = mockExec.mock.calls.find((c: string[]) =>
        (c[0] as string).includes('git clone'),
      );
      expect(cloneCmd).toBeDefined();
      expect(cloneCmd![0]).toContain('https://github.com/user/gh-plugin.git');
    });

    it('should use git SHA as version when no explicit version', async () => {
      setupMarketplace('sha-market', [
        {
          name: 'no-ver-plugin',
          title: 'No Version',
          description: 'No explicit version',
          source: './packages/no-ver-plugin',
          tags: [],
        },
      ]);

      // Create the plugin source directory
      const marketplaceDir = join(pluginsDir, 'marketplaces', 'sha-market');
      setupDir(join(marketplaceDir, 'packages', 'no-ver-plugin'));

      // Mock git rev-parse to return a SHA
      mockExec.mockImplementation((cmd: string) => {
        if (cmd.includes('rev-parse HEAD')) {
          return 'abcdef123456789012345678901234567890\n';
        }
        return '';
      });

      await installer.install('no-ver-plugin', 'sha-market');

      // Should use first 12 chars of SHA
      const targetDir = join(pluginsDir, 'cache', 'sha-market', 'no-ver-plugin', 'abcdef123456');
      expect(existsSync(targetDir)).toBe(true);
    });

    it('should throw when plugin not found in marketplace', async () => {
      setupMarketplace('empty-market', []);

      await expect(installer.install('nonexistent', 'empty-market')).rejects.toThrow(
        'Plugin "nonexistent" not found in marketplace "empty-market"',
      );
    });

    it('should throw when plugin already installed at same version', async () => {
      setupMarketplace('dup-market', [
        {
          name: 'dup-plugin',
          title: 'Dup',
          description: 'Duplicate test',
          source: './packages/dup-plugin',
          tags: [],
          version: '1.0.0',
        },
      ]);

      // Create existing install
      const existingDir = join(pluginsDir, 'cache', 'dup-market', 'dup-plugin', '1.0.0');
      setupDir(existingDir);

      await expect(installer.install('dup-plugin', 'dup-market')).rejects.toThrow(
        'already installed',
      );
    });

    it('should throw when relative source path does not exist in marketplace', async () => {
      setupMarketplace('missing-src', [
        {
          name: 'bad-path-plugin',
          title: 'Bad Path',
          description: 'Source path missing',
          source: './packages/nonexistent',
          tags: [],
          version: '1.0.0',
        },
      ]);

      await expect(installer.install('bad-path-plugin', 'missing-src')).rejects.toThrow(
        'Plugin source path',
      );
    });

    it('should throw when git clone fails', async () => {
      setupMarketplace('fail-market', [
        {
          name: 'fail-plugin',
          title: 'Fail',
          description: 'Clone fails',
          source: { type: 'github', repo: 'bad/repo' },
          tags: [],
          version: '1.0.0',
        },
      ]);

      mockExec.mockImplementation((cmd: string) => {
        if (cmd.includes('git clone')) {
          throw new Error('git clone failed');
        }
        return '';
      });

      await expect(installer.install('fail-plugin', 'fail-market')).rejects.toThrow(
        'Failed to clone plugin "fail-plugin"',
      );
    });
  });

  describe('uninstall', () => {
    it('should remove plugin from cache and registry', async () => {
      const installPath = join(pluginsDir, 'cache', 'market', 'test-plugin', '1.0.0');
      setupDir(installPath);
      writeJson(join(pluginsDir, 'installed_plugins.json'), {
        'test-plugin@market': {
          pluginName: 'test-plugin',
          marketplace: 'market',
          version: '1.0.0',
          installPath,
          installedAt: '2026-01-01T00:00:00.000Z',
        },
      });

      await installer.uninstall('test-plugin@market');

      expect(existsSync(installPath)).toBe(false);
      const registry = JSON.parse(
        readFileSync(join(pluginsDir, 'installed_plugins.json'), 'utf-8'),
      ) as Record<string, unknown>;
      expect(registry['test-plugin@market']).toBeUndefined();
    });

    it('should also remove settings entry on uninstall', async () => {
      const installPath = join(pluginsDir, 'cache', 'market', 'rm-plugin', '1.0.0');
      setupDir(installPath);
      writeJson(join(pluginsDir, 'installed_plugins.json'), {
        'rm-plugin@market': {
          pluginName: 'rm-plugin',
          marketplace: 'market',
          version: '1.0.0',
          installPath,
          installedAt: '2026-01-01T00:00:00.000Z',
        },
      });
      writeJson(settingsPath, {
        enabledPlugins: { 'rm-plugin@market': true },
      });

      await installer.uninstall('rm-plugin@market');

      const settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
      const enabledPlugins = settings.enabledPlugins as Record<string, boolean>;
      expect(enabledPlugins['rm-plugin@market']).toBeUndefined();
    });

    it('should throw when plugin is not installed', async () => {
      await expect(installer.uninstall('nonexistent@market')).rejects.toThrow(
        'Plugin "nonexistent@market" is not installed',
      );
    });
  });

  describe('enable/disable', () => {
    it('should enable a plugin by updating settings', async () => {
      writeJson(settingsPath, { enabledPlugins: { 'test@mp': false } });

      await installer.enable('test@mp');

      const settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
      const enabledPlugins = settings.enabledPlugins as Record<string, boolean>;
      expect(enabledPlugins['test@mp']).toBe(true);
    });

    it('should disable a plugin by updating settings', async () => {
      writeJson(settingsPath, { enabledPlugins: { 'test@mp': true } });

      await installer.disable('test@mp');

      const settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
      const enabledPlugins = settings.enabledPlugins as Record<string, boolean>;
      expect(enabledPlugins['test@mp']).toBe(false);
    });

    it('should create settings file if it does not exist', async () => {
      await installer.enable('new-plugin@mp');

      expect(existsSync(settingsPath)).toBe(true);
      const settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
      const enabledPlugins = settings.enabledPlugins as Record<string, boolean>;
      expect(enabledPlugins['new-plugin@mp']).toBe(true);
    });
  });

  describe('getPluginsByMarketplace', () => {
    it('should return plugins from a specific marketplace', () => {
      writeJson(join(pluginsDir, 'installed_plugins.json'), {
        'a@mp1': {
          pluginName: 'a',
          marketplace: 'mp1',
          version: '1.0.0',
          installPath: '/path/a',
          installedAt: '2026-01-01T00:00:00.000Z',
        },
        'b@mp2': {
          pluginName: 'b',
          marketplace: 'mp2',
          version: '1.0.0',
          installPath: '/path/b',
          installedAt: '2026-01-01T00:00:00.000Z',
        },
        'c@mp1': {
          pluginName: 'c',
          marketplace: 'mp1',
          version: '1.0.0',
          installPath: '/path/c',
          installedAt: '2026-01-01T00:00:00.000Z',
        },
      });

      const mp1Plugins = installer.getPluginsByMarketplace('mp1');
      expect(mp1Plugins).toHaveLength(2);
      expect(mp1Plugins.map((p) => p.pluginName)).toContain('a');
      expect(mp1Plugins.map((p) => p.pluginName)).toContain('c');
    });

    it('should return empty array when no plugins from marketplace', () => {
      const plugins = installer.getPluginsByMarketplace('nonexistent');
      expect(plugins).toEqual([]);
    });
  });
});
