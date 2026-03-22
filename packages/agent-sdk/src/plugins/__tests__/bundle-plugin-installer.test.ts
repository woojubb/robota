import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BundlePluginInstaller } from '../bundle-plugin-installer.js';
import type { IPluginSource } from '../bundle-plugin-installer.js';
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
  let mockExec: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    const runDir = join(TMP_BASE, 'run-' + Math.random().toString(36).slice(2));
    pluginsDir = join(runDir, 'plugins');
    settingsPath = join(runDir, 'settings.json');
    setupDir(pluginsDir);

    mockExec = vi.fn();

    installer = new BundlePluginInstaller({
      pluginsDir,
      settingsStore: new PluginSettingsStore(settingsPath),
      exec: mockExec,
    });
  });

  afterEach(() => {
    if (existsSync(TMP_BASE)) {
      rmSync(TMP_BASE, { recursive: true, force: true });
    }
  });

  describe('install', () => {
    it('should clone plugin from github source', async () => {
      const source: IPluginSource = { type: 'github', repo: 'user/my-plugin', ref: 'v1.0' };

      await installer.install('my-plugin', 'custom-market', source);

      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('git clone'),
        expect.objectContaining({ timeout: expect.any(Number) }),
      );
      const call = mockExec.mock.calls[0][0] as string;
      expect(call).toContain('https://github.com/user/my-plugin.git');
      expect(call).toContain('--branch v1.0');
      expect(call).toContain(join(pluginsDir, 'my-plugin@custom-market'));
    });

    it('should clone plugin from git source', async () => {
      const source: IPluginSource = { type: 'git', url: 'https://example.com/repo.git' };

      await installer.install('repo-plugin', 'market', source);

      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('git clone'),
        expect.objectContaining({ timeout: expect.any(Number) }),
      );
      const call = mockExec.mock.calls[0][0] as string;
      expect(call).toContain('https://example.com/repo.git');
      expect(call).toContain(join(pluginsDir, 'repo-plugin@market'));
    });

    it('should use default ref when not specified for github source', async () => {
      const source: IPluginSource = { type: 'github', repo: 'org/plugin' };

      await installer.install('plugin', 'mp', source);

      const call = mockExec.mock.calls[0][0] as string;
      expect(call).not.toContain('--branch');
    });

    it('should copy plugin from local source', async () => {
      // Create a local plugin directory
      const localDir = join(TMP_BASE, 'local-plugin');
      setupDir(join(localDir, '.claude-plugin'));
      writeJson(join(localDir, '.claude-plugin', 'plugin.json'), {
        name: 'local-plugin',
        version: '1.0.0',
        description: 'A local plugin',
        features: {},
      });

      const source: IPluginSource = { type: 'local', path: localDir };

      await installer.install('local-plugin', 'local-market', source);

      const targetDir = join(pluginsDir, 'local-plugin@local-market');
      expect(existsSync(targetDir)).toBe(true);
      expect(existsSync(join(targetDir, '.claude-plugin', 'plugin.json'))).toBe(true);
    });

    it('should throw when local source path does not exist', async () => {
      const source: IPluginSource = { type: 'local', path: '/nonexistent/path' };

      await expect(installer.install('bad', 'mp', source)).rejects.toThrow(
        'Local plugin source path does not exist: /nonexistent/path',
      );
    });

    it('should throw when git clone fails', async () => {
      mockExec.mockImplementation(() => {
        throw new Error('git clone failed');
      });

      const source: IPluginSource = { type: 'github', repo: 'bad/repo' };

      await expect(installer.install('bad-plugin', 'mp', source)).rejects.toThrow(
        'Failed to clone plugin "bad-plugin": git clone failed',
      );
    });
  });

  describe('uninstall', () => {
    it('should remove plugin directory', async () => {
      const pluginDir = join(pluginsDir, 'my-plugin@market');
      setupDir(join(pluginDir, '.claude-plugin'));
      writeJson(join(pluginDir, '.claude-plugin', 'plugin.json'), {
        name: 'my-plugin',
        version: '1.0.0',
        description: 'To uninstall',
        features: {},
      });

      expect(existsSync(pluginDir)).toBe(true);

      await installer.uninstall('my-plugin@market');

      expect(existsSync(pluginDir)).toBe(false);
    });

    it('should also remove settings entry on uninstall', async () => {
      const pluginDir = join(pluginsDir, 'rm-plugin@market');
      setupDir(pluginDir);

      // Create settings with the plugin
      writeJson(settingsPath, {
        enabledPlugins: { 'rm-plugin@market': true },
      });

      await installer.uninstall('rm-plugin@market');

      const settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
      const enabledPlugins = settings.enabledPlugins as Record<string, boolean>;
      expect(enabledPlugins['rm-plugin@market']).toBeUndefined();
    });

    it('should throw when plugin directory does not exist', async () => {
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

    it('should preserve existing settings when updating', async () => {
      writeJson(settingsPath, {
        enabledPlugins: { 'existing@mp': true },
        otherSetting: 'value',
      });

      await installer.disable('another@mp');

      const settings = JSON.parse(readFileSync(settingsPath, 'utf-8')) as Record<string, unknown>;
      expect(settings.otherSetting).toBe('value');
      const enabledPlugins = settings.enabledPlugins as Record<string, boolean>;
      expect(enabledPlugins['existing@mp']).toBe(true);
      expect(enabledPlugins['another@mp']).toBe(false);
    });
  });
});
