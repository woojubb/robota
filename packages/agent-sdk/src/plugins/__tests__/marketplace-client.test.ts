import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MarketplaceClient } from '../marketplace-client.js';
import type { IMarketplaceSource } from '../marketplace-client.js';

const TMP_BASE = join(tmpdir(), 'robota-marketplace-test-' + process.pid);

function setupDir(path: string): void {
  mkdirSync(path, { recursive: true });
}

function writeJson(path: string, data: unknown): void {
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
}

describe('MarketplaceClient', () => {
  let pluginsDir: string;
  let client: MarketplaceClient;
  let mockExec: Mock;

  beforeEach(() => {
    const runDir = join(TMP_BASE, 'run-' + Math.random().toString(36).slice(2));
    pluginsDir = join(runDir, 'plugins');
    setupDir(pluginsDir);

    mockExec = vi.fn().mockReturnValue('');
    client = new MarketplaceClient({
      pluginsDir,
      exec: mockExec as (cmd: string, opts: { timeout: number; stdio?: string }) => string | Buffer,
    });
  });

  afterEach(() => {
    if (existsSync(TMP_BASE)) {
      rmSync(TMP_BASE, { recursive: true, force: true });
    }
  });

  describe('addMarketplace', () => {
    it('should clone a GitHub repo and register the marketplace', () => {
      const source: IMarketplaceSource = { type: 'github', repo: 'owner/marketplace-repo' };

      // Mock exec to simulate git clone by creating the directory with a manifest
      mockExec.mockImplementation((cmd: string) => {
        if (cmd.includes('git clone')) {
          // Extract target directory from clone command
          const parts = cmd.split(' ');
          const targetDir = parts[parts.length - 1];
          setupDir(join(targetDir, '.claude-plugin'));
          writeJson(join(targetDir, '.claude-plugin', 'marketplace.json'), {
            name: 'test-marketplace',
            version: '1.0',
            plugins: [],
          });
        }
        return '';
      });

      const name = client.addMarketplace(source);

      expect(name).toBe('test-marketplace');
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('git clone --depth 1'),
        expect.objectContaining({ timeout: expect.any(Number) }),
      );
      const cloneCmd = mockExec.mock.calls[0][0] as string;
      expect(cloneCmd).toContain('https://github.com/owner/marketplace-repo.git');

      // Should be registered in known_marketplaces.json
      const registryPath = join(pluginsDir, 'known_marketplaces.json');
      expect(existsSync(registryPath)).toBe(true);
      const registry = JSON.parse(readFileSync(registryPath, 'utf-8')) as Record<string, unknown>;
      expect(registry['test-marketplace']).toBeDefined();
    });

    it('should clone a git URL source', () => {
      const source: IMarketplaceSource = { type: 'git', url: 'https://example.com/repo.git' };

      mockExec.mockImplementation((cmd: string) => {
        if (cmd.includes('git clone')) {
          const parts = cmd.split(' ');
          const targetDir = parts[parts.length - 1];
          setupDir(join(targetDir, '.claude-plugin'));
          writeJson(join(targetDir, '.claude-plugin', 'marketplace.json'), {
            name: 'git-marketplace',
            version: '1.0',
            plugins: [],
          });
        }
        return '';
      });

      const name = client.addMarketplace(source);

      expect(name).toBe('git-marketplace');
      const cloneCmd = mockExec.mock.calls[0][0] as string;
      expect(cloneCmd).toContain('https://example.com/repo.git');
    });

    it('should throw when clone fails', () => {
      const source: IMarketplaceSource = { type: 'github', repo: 'bad/repo' };

      mockExec.mockImplementation(() => {
        throw new Error('git clone failed');
      });

      expect(() => client.addMarketplace(source)).toThrow('Failed to clone marketplace');
    });

    it('should throw when cloned repo has no marketplace.json', () => {
      const source: IMarketplaceSource = { type: 'github', repo: 'owner/repo' };

      mockExec.mockImplementation((cmd: string) => {
        if (cmd.includes('git clone')) {
          const parts = cmd.split(' ');
          const targetDir = parts[parts.length - 1];
          // Create dir but no manifest
          setupDir(targetDir);
        }
        return '';
      });

      expect(() => client.addMarketplace(source)).toThrow(
        'does not contain .claude-plugin/marketplace.json',
      );
    });

    it('should throw when marketplace name already exists', () => {
      const source: IMarketplaceSource = { type: 'github', repo: 'owner/repo' };

      mockExec.mockImplementation((cmd: string) => {
        if (cmd.includes('git clone')) {
          const parts = cmd.split(' ');
          const targetDir = parts[parts.length - 1];
          setupDir(join(targetDir, '.claude-plugin'));
          writeJson(join(targetDir, '.claude-plugin', 'marketplace.json'), {
            name: 'dup-market',
            version: '1.0',
            plugins: [],
          });
        }
        return '';
      });

      client.addMarketplace(source);

      expect(() => client.addMarketplace(source)).toThrow(
        'Marketplace "dup-market" already exists',
      );
    });

    it('should throw for url source type', () => {
      const source = {
        type: 'url',
        url: 'https://example.com/manifest.json',
      } as IMarketplaceSource;

      expect(() => client.addMarketplace(source)).toThrow(
        'URL marketplace source is not yet supported',
      );
    });

    it('should copy a local directory instead of git clone', () => {
      const localDir = join(pluginsDir, '_local_source');
      setupDir(join(localDir, '.claude-plugin'));
      writeJson(join(localDir, '.claude-plugin', 'marketplace.json'), {
        name: 'local-mp',
        version: '1.0',
        plugins: [],
      });

      const source: IMarketplaceSource = { type: 'local', path: localDir };
      const name = client.addMarketplace(source);

      expect(name).toBe('local-mp');
      // exec should NOT have been called (no git clone)
      expect(mockExec).not.toHaveBeenCalled();

      // Should be registered
      const registryPath = join(pluginsDir, 'known_marketplaces.json');
      const registry = JSON.parse(readFileSync(registryPath, 'utf-8')) as Record<string, unknown>;
      expect(registry['local-mp']).toBeDefined();

      // Directory should exist at final location
      const finalDir = join(pluginsDir, 'marketplaces', 'local-mp');
      expect(existsSync(finalDir)).toBe(true);
    });

    it('should throw when local source path does not exist', () => {
      const source: IMarketplaceSource = { type: 'local', path: '/nonexistent/path' };

      expect(() => client.addMarketplace(source)).toThrow(
        'Local marketplace path does not exist: /nonexistent/path',
      );
    });

    it('should throw when local directory has no marketplace.json', () => {
      const localDir = join(pluginsDir, '_local_no_manifest');
      setupDir(localDir);

      const source: IMarketplaceSource = { type: 'local', path: localDir };

      expect(() => client.addMarketplace(source)).toThrow(
        'Local directory does not contain .claude-plugin/marketplace.json',
      );
    });
  });

  describe('removeMarketplace', () => {
    it('should remove marketplace clone and registry entry', () => {
      // Set up a registered marketplace
      const marketplaceDir = join(pluginsDir, 'marketplaces', 'test-mp');
      setupDir(marketplaceDir);
      writeJson(join(pluginsDir, 'known_marketplaces.json'), {
        'test-mp': {
          source: { type: 'github', repo: 'owner/repo' },
          installLocation: marketplaceDir,
          lastUpdated: '2026-01-01T00:00:00.000Z',
        },
      });

      client.removeMarketplace('test-mp');

      expect(existsSync(marketplaceDir)).toBe(false);
      const registry = JSON.parse(
        readFileSync(join(pluginsDir, 'known_marketplaces.json'), 'utf-8'),
      ) as Record<string, unknown>;
      expect(registry['test-mp']).toBeUndefined();
    });

    it('should throw when marketplace not found', () => {
      expect(() => client.removeMarketplace('nonexistent')).toThrow(
        'Marketplace "nonexistent" not found',
      );
    });

    it('should uninstall plugins belonging to that marketplace', () => {
      const marketplaceDir = join(pluginsDir, 'marketplaces', 'uninstall-mp');
      setupDir(marketplaceDir);

      // Create installed_plugins.json with plugins from this marketplace and another
      const pluginCacheDir = join(pluginsDir, 'cache', 'uninstall-mp', 'plugin-a', '1.0.0');
      setupDir(pluginCacheDir);
      writeJson(join(pluginsDir, 'installed_plugins.json'), {
        'plugin-a': {
          marketplace: 'uninstall-mp',
          installPath: pluginCacheDir,
        },
        'plugin-b': {
          marketplace: 'other-mp',
          installPath: '/some/other/path',
        },
      });

      writeJson(join(pluginsDir, 'known_marketplaces.json'), {
        'uninstall-mp': {
          source: { type: 'github', repo: 'owner/repo' },
          installLocation: marketplaceDir,
          lastUpdated: '2026-01-01T00:00:00.000Z',
        },
      });

      client.removeMarketplace('uninstall-mp');

      // Plugin cache dir should be deleted
      expect(existsSync(pluginCacheDir)).toBe(false);

      // installed_plugins.json should only contain plugin-b
      const installed = JSON.parse(
        readFileSync(join(pluginsDir, 'installed_plugins.json'), 'utf-8'),
      ) as Record<string, unknown>;
      expect(installed['plugin-a']).toBeUndefined();
      expect(installed['plugin-b']).toBeDefined();
    });

    it('should handle removal when installed_plugins.json does not exist', () => {
      const marketplaceDir = join(pluginsDir, 'marketplaces', 'no-installed-mp');
      setupDir(marketplaceDir);
      writeJson(join(pluginsDir, 'known_marketplaces.json'), {
        'no-installed-mp': {
          source: { type: 'github', repo: 'owner/repo' },
          installLocation: marketplaceDir,
          lastUpdated: '2026-01-01T00:00:00.000Z',
        },
      });

      // Should not throw even though installed_plugins.json does not exist
      expect(() => client.removeMarketplace('no-installed-mp')).not.toThrow();
      expect(existsSync(marketplaceDir)).toBe(false);
    });
  });

  describe('updateMarketplace', () => {
    it('should run git pull on the marketplace clone', () => {
      const marketplaceDir = join(pluginsDir, 'marketplaces', 'update-mp');
      setupDir(marketplaceDir);
      writeJson(join(pluginsDir, 'known_marketplaces.json'), {
        'update-mp': {
          source: { type: 'github', repo: 'owner/repo' },
          installLocation: marketplaceDir,
          lastUpdated: '2026-01-01T00:00:00.000Z',
        },
      });

      mockExec.mockReturnValue('');

      client.updateMarketplace('update-mp');

      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('git -C'),
        expect.objectContaining({ timeout: expect.any(Number) }),
      );
      const pullCmd = mockExec.mock.calls[0][0] as string;
      expect(pullCmd).toContain('pull');
    });

    it('should throw when marketplace not found', () => {
      expect(() => client.updateMarketplace('nonexistent')).toThrow(
        'Marketplace "nonexistent" not found',
      );
    });

    it('should throw when marketplace directory does not exist', () => {
      writeJson(join(pluginsDir, 'known_marketplaces.json'), {
        'missing-dir': {
          source: { type: 'github', repo: 'owner/repo' },
          installLocation: join(pluginsDir, 'marketplaces', 'missing-dir'),
          lastUpdated: '2026-01-01T00:00:00.000Z',
        },
      });

      expect(() => client.updateMarketplace('missing-dir')).toThrow(
        'Marketplace directory for "missing-dir" does not exist',
      );
    });

    it('should re-copy local source directory instead of git pull', () => {
      const localSourceDir = join(pluginsDir, '_local_update_source');
      setupDir(localSourceDir);
      writeJson(join(localSourceDir, 'data.json'), { updated: true });

      const marketplaceDir = join(pluginsDir, 'marketplaces', 'local-update-mp');
      setupDir(marketplaceDir);
      writeJson(join(marketplaceDir, 'data.json'), { updated: false });

      writeJson(join(pluginsDir, 'known_marketplaces.json'), {
        'local-update-mp': {
          source: { type: 'local', path: localSourceDir },
          installLocation: marketplaceDir,
          lastUpdated: '2026-01-01T00:00:00.000Z',
        },
      });

      client.updateMarketplace('local-update-mp');

      // exec should NOT have been called (no git pull)
      expect(mockExec).not.toHaveBeenCalled();

      // Directory should exist with updated content
      expect(existsSync(marketplaceDir)).toBe(true);
      const data = JSON.parse(readFileSync(join(marketplaceDir, 'data.json'), 'utf-8')) as Record<
        string,
        unknown
      >;
      expect(data.updated).toBe(true);

      // Timestamp should be updated in registry
      const registry = JSON.parse(
        readFileSync(join(pluginsDir, 'known_marketplaces.json'), 'utf-8'),
      ) as Record<string, { lastUpdated: string }>;
      expect(registry['local-update-mp'].lastUpdated).not.toBe('2026-01-01T00:00:00.000Z');
    });

    it('should throw when local source path does not exist during update', () => {
      const marketplaceDir = join(pluginsDir, 'marketplaces', 'local-missing-mp');
      setupDir(marketplaceDir);

      writeJson(join(pluginsDir, 'known_marketplaces.json'), {
        'local-missing-mp': {
          source: { type: 'local', path: '/nonexistent/local/path' },
          installLocation: marketplaceDir,
          lastUpdated: '2026-01-01T00:00:00.000Z',
        },
      });

      expect(() => client.updateMarketplace('local-missing-mp')).toThrow(
        'Local marketplace path does not exist: /nonexistent/local/path',
      );
    });

    it('should throw when git pull fails', () => {
      const marketplaceDir = join(pluginsDir, 'marketplaces', 'pull-fail-mp');
      setupDir(marketplaceDir);

      writeJson(join(pluginsDir, 'known_marketplaces.json'), {
        'pull-fail-mp': {
          source: { type: 'github', repo: 'owner/repo' },
          installLocation: marketplaceDir,
          lastUpdated: '2026-01-01T00:00:00.000Z',
        },
      });

      mockExec.mockImplementation(() => {
        throw new Error('network error');
      });

      expect(() => client.updateMarketplace('pull-fail-mp')).toThrow(
        'Failed to update marketplace "pull-fail-mp": network error',
      );
    });
  });

  describe('listMarketplaces', () => {
    it('should return empty list when no marketplaces registered', () => {
      const list = client.listMarketplaces();
      expect(list).toEqual([]);
    });

    it('should list all registered marketplaces', () => {
      writeJson(join(pluginsDir, 'known_marketplaces.json'), {
        'mp-a': {
          source: { type: 'github', repo: 'a/a' },
          installLocation: '/path/a',
          lastUpdated: '2026-01-01T00:00:00.000Z',
        },
        'mp-b': {
          source: { type: 'git', url: 'https://example.com/b.git' },
          installLocation: '/path/b',
          lastUpdated: '2026-01-02T00:00:00.000Z',
        },
      });

      const list = client.listMarketplaces();
      expect(list).toHaveLength(2);
      expect(list.map((m) => m.name)).toContain('mp-a');
      expect(list.map((m) => m.name)).toContain('mp-b');
    });
  });

  describe('fetchManifest', () => {
    it('should read manifest from cloned directory', () => {
      const marketplaceDir = join(pluginsDir, 'marketplaces', 'fetch-mp');
      setupDir(join(marketplaceDir, '.claude-plugin'));
      writeJson(join(marketplaceDir, '.claude-plugin', 'marketplace.json'), {
        name: 'fetch-mp',
        version: '1.0',
        plugins: [
          {
            name: 'test-plugin',
            title: 'Test Plugin',
            description: 'A test plugin',
            source: './packages/test-plugin',
            tags: ['test'],
          },
        ],
      });
      writeJson(join(pluginsDir, 'known_marketplaces.json'), {
        'fetch-mp': {
          source: { type: 'github', repo: 'owner/repo' },
          installLocation: marketplaceDir,
          lastUpdated: '2026-01-01T00:00:00.000Z',
        },
      });

      const manifest = client.fetchManifest('fetch-mp');

      expect(manifest.name).toBe('fetch-mp');
      expect(manifest.plugins).toHaveLength(1);
      expect(manifest.plugins[0].name).toBe('test-plugin');
    });

    it('should throw when marketplace not found', () => {
      expect(() => client.fetchManifest('nonexistent')).toThrow(
        'Marketplace "nonexistent" not found',
      );
    });

    it('should throw when manifest file missing from clone', () => {
      const marketplaceDir = join(pluginsDir, 'marketplaces', 'no-manifest');
      setupDir(marketplaceDir);
      writeJson(join(pluginsDir, 'known_marketplaces.json'), {
        'no-manifest': {
          source: { type: 'github', repo: 'owner/repo' },
          installLocation: marketplaceDir,
          lastUpdated: '2026-01-01T00:00:00.000Z',
        },
      });

      expect(() => client.fetchManifest('no-manifest')).toThrow(
        'does not contain .claude-plugin/marketplace.json',
      );
    });
  });

  describe('getMarketplaceDir', () => {
    it('should return the install location', () => {
      writeJson(join(pluginsDir, 'known_marketplaces.json'), {
        'dir-mp': {
          source: { type: 'github', repo: 'owner/repo' },
          installLocation: '/some/path/dir-mp',
          lastUpdated: '2026-01-01T00:00:00.000Z',
        },
      });

      expect(client.getMarketplaceDir('dir-mp')).toBe('/some/path/dir-mp');
    });

    it('should throw when marketplace not found', () => {
      expect(() => client.getMarketplaceDir('nonexistent')).toThrow(
        'Marketplace "nonexistent" not found',
      );
    });
  });

  describe('getMarketplaceSha', () => {
    it('should return first 12 chars of git SHA', () => {
      writeJson(join(pluginsDir, 'known_marketplaces.json'), {
        'sha-mp': {
          source: { type: 'github', repo: 'owner/repo' },
          installLocation: '/some/path',
          lastUpdated: '2026-01-01T00:00:00.000Z',
        },
      });

      mockExec.mockReturnValue('abcdef123456789012\n');

      const sha = client.getMarketplaceSha('sha-mp');
      expect(sha).toBe('abcdef123456');
    });

    it('should return "unknown" when git command fails', () => {
      writeJson(join(pluginsDir, 'known_marketplaces.json'), {
        'fail-sha': {
          source: { type: 'github', repo: 'owner/repo' },
          installLocation: '/some/path',
          lastUpdated: '2026-01-01T00:00:00.000Z',
        },
      });

      mockExec.mockImplementation(() => {
        throw new Error('not a git repo');
      });

      const sha = client.getMarketplaceSha('fail-sha');
      expect(sha).toBe('unknown');
    });
  });

  describe('listAvailablePlugins', () => {
    it('should list plugins from all marketplaces', () => {
      // Set up two marketplaces with manifests
      const mp1Dir = join(pluginsDir, 'marketplaces', 'mp1');
      const mp2Dir = join(pluginsDir, 'marketplaces', 'mp2');
      setupDir(join(mp1Dir, '.claude-plugin'));
      setupDir(join(mp2Dir, '.claude-plugin'));

      writeJson(join(mp1Dir, '.claude-plugin', 'marketplace.json'), {
        name: 'mp1',
        version: '1.0',
        plugins: [
          { name: 'plugin-a', title: 'A', description: 'desc-a', source: './a', tags: ['a'] },
        ],
      });
      writeJson(join(mp2Dir, '.claude-plugin', 'marketplace.json'), {
        name: 'mp2',
        version: '1.0',
        plugins: [
          { name: 'plugin-b', title: 'B', description: 'desc-b', source: './b', tags: ['b'] },
        ],
      });
      writeJson(join(pluginsDir, 'known_marketplaces.json'), {
        mp1: {
          source: { type: 'github', repo: 'a/a' },
          installLocation: mp1Dir,
          lastUpdated: '2026-01-01T00:00:00.000Z',
        },
        mp2: {
          source: { type: 'github', repo: 'b/b' },
          installLocation: mp2Dir,
          lastUpdated: '2026-01-01T00:00:00.000Z',
        },
      });

      const plugins = client.listAvailablePlugins();
      expect(plugins).toHaveLength(2);
      expect(plugins[0].name).toBe('plugin-a');
      expect(plugins[0].marketplace).toBe('mp1');
      expect(plugins[1].name).toBe('plugin-b');
      expect(plugins[1].marketplace).toBe('mp2');
    });

    it('should skip failed marketplaces', () => {
      // One marketplace with valid manifest, one without
      const mp1Dir = join(pluginsDir, 'marketplaces', 'valid');
      setupDir(join(mp1Dir, '.claude-plugin'));
      writeJson(join(mp1Dir, '.claude-plugin', 'marketplace.json'), {
        name: 'valid',
        version: '1.0',
        plugins: [{ name: 'survivor', title: 'S', description: 'desc', source: './s', tags: [] }],
      });

      const mp2Dir = join(pluginsDir, 'marketplaces', 'broken');
      setupDir(mp2Dir); // No manifest file

      writeJson(join(pluginsDir, 'known_marketplaces.json'), {
        valid: {
          source: { type: 'github', repo: 'a/a' },
          installLocation: mp1Dir,
          lastUpdated: '2026-01-01T00:00:00.000Z',
        },
        broken: {
          source: { type: 'github', repo: 'b/b' },
          installLocation: mp2Dir,
          lastUpdated: '2026-01-01T00:00:00.000Z',
        },
      });

      const plugins = client.listAvailablePlugins();
      expect(plugins).toHaveLength(1);
      expect(plugins[0].name).toBe('survivor');
    });
  });
});
