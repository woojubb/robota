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
        'URL source type does not support git cloning',
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
