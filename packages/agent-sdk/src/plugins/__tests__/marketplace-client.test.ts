import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MarketplaceClient } from '../marketplace-client.js';
import type { IMarketplaceSource, IMarketplaceManifest } from '../marketplace-client.js';

describe('MarketplaceClient', () => {
  let client: MarketplaceClient;

  beforeEach(() => {
    client = new MarketplaceClient();
  });

  describe('default sources', () => {
    it('should have claude-plugins-official as default source', () => {
      const sources = client.listSources();
      expect(sources).toContainEqual(expect.objectContaining({ name: 'claude-plugins-official' }));
    });

    it('should configure claude-plugins-official as a github source', () => {
      const sources = client.listSources();
      const official = sources.find((s) => s.name === 'claude-plugins-official');
      expect(official).toBeDefined();
      expect(official!.source.type).toBe('github');
      if (official!.source.type === 'github') {
        expect(official!.source.repo).toBe('anthropics/claude-code');
      }
    });
  });

  describe('source management', () => {
    it('should add a new source', () => {
      const source: IMarketplaceSource = { type: 'github', repo: 'user/plugins' };
      client.addSource('custom', source);
      const sources = client.listSources();
      expect(sources).toContainEqual({ name: 'custom', source });
    });

    it('should remove an existing source', () => {
      const source: IMarketplaceSource = { type: 'local', path: '/tmp/plugins' };
      client.addSource('temp', source);
      client.removeSource('temp');
      const sources = client.listSources();
      expect(sources.find((s) => s.name === 'temp')).toBeUndefined();
    });

    it('should throw when removing a non-existent source', () => {
      expect(() => client.removeSource('nonexistent')).toThrow(
        'Marketplace source "nonexistent" not found',
      );
    });

    it('should throw when adding a duplicate source name', () => {
      const source: IMarketplaceSource = { type: 'local', path: '/tmp' };
      client.addSource('dup', source);
      expect(() => client.addSource('dup', source)).toThrow(
        'Marketplace source "dup" already exists',
      );
    });

    it('should support multiple marketplace sources', () => {
      client.addSource('source-a', { type: 'local', path: '/a' });
      client.addSource('source-b', { type: 'url', url: 'https://example.com/manifest.json' });
      const sources = client.listSources();
      // Default + 2 added
      expect(sources.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('fetchManifest', () => {
    it('should throw when fetching from a non-existent source', async () => {
      await expect(client.fetchManifest('nonexistent')).rejects.toThrow(
        'Marketplace source "nonexistent" not found',
      );
    });

    it('should fetch manifest from a URL source', async () => {
      const manifest: IMarketplaceManifest = {
        version: '1.0',
        plugins: [
          {
            name: 'test-plugin',
            title: 'Test Plugin',
            description: 'A test plugin',
            source: { type: 'git', url: 'https://github.com/user/plugin.git' },
            tags: ['test'],
          },
        ],
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(manifest),
      });

      const clientWithFetch = new MarketplaceClient({ fetch: mockFetch });
      clientWithFetch.addSource('test-url', {
        type: 'url',
        url: 'https://example.com/marketplace.json',
      });

      const result = await clientWithFetch.fetchManifest('test-url');
      expect(result).toEqual(manifest);
      expect(mockFetch).toHaveBeenCalledWith('https://example.com/marketplace.json');
    });

    it('should fetch manifest from a GitHub source', async () => {
      const manifest: IMarketplaceManifest = {
        version: '1.0',
        plugins: [
          {
            name: 'gh-plugin',
            title: 'GH Plugin',
            description: 'From GitHub',
            source: { type: 'github', repo: 'user/plugin' },
            tags: [],
          },
        ],
      };

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(manifest),
      });

      const clientWithFetch = new MarketplaceClient({ fetch: mockFetch });
      // Use the default claude-plugins-official or add a custom github source
      clientWithFetch.addSource('my-gh', { type: 'github', repo: 'user/plugins', ref: 'v2' });

      const result = await clientWithFetch.fetchManifest('my-gh');
      expect(result).toEqual(manifest);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://raw.githubusercontent.com/user/plugins/v2/.claude-plugin/marketplace.json',
      );
    });

    it('should use "main" as default ref for GitHub sources', async () => {
      const manifest: IMarketplaceManifest = { version: '1.0', plugins: [] };
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(manifest),
      });

      const clientWithFetch = new MarketplaceClient({ fetch: mockFetch });
      clientWithFetch.addSource('no-ref', { type: 'github', repo: 'org/repo' });

      await clientWithFetch.fetchManifest('no-ref');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://raw.githubusercontent.com/org/repo/main/.claude-plugin/marketplace.json',
      );
    });

    it('should throw when fetch response is not ok', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const clientWithFetch = new MarketplaceClient({ fetch: mockFetch });
      clientWithFetch.addSource('bad', { type: 'url', url: 'https://example.com/bad.json' });

      await expect(clientWithFetch.fetchManifest('bad')).rejects.toThrow(
        'Failed to fetch manifest from "bad": 404 Not Found',
      );
    });
  });

  describe('listAvailablePlugins', () => {
    it('should list available plugins from all sources', async () => {
      const manifest1: IMarketplaceManifest = {
        version: '1.0',
        plugins: [
          {
            name: 'plugin-a',
            title: 'Plugin A',
            description: 'Desc A',
            source: { type: 'github', repo: 'a/a' },
            tags: ['a'],
          },
        ],
      };
      const manifest2: IMarketplaceManifest = {
        version: '1.0',
        plugins: [
          {
            name: 'plugin-b',
            title: 'Plugin B',
            description: 'Desc B',
            source: { type: 'github', repo: 'b/b' },
            tags: ['b'],
          },
        ],
      };

      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation(() => {
        callCount++;
        const manifest = callCount === 1 ? manifest1 : manifest2;
        return Promise.resolve({ ok: true, json: () => Promise.resolve(manifest) });
      });

      const clientWithFetch = new MarketplaceClient({ fetch: mockFetch });
      // Remove default source to control test
      clientWithFetch.removeSource('claude-plugins-official');
      clientWithFetch.addSource('src1', { type: 'url', url: 'https://a.com/m.json' });
      clientWithFetch.addSource('src2', { type: 'url', url: 'https://b.com/m.json' });

      const plugins = await clientWithFetch.listAvailablePlugins();
      expect(plugins).toHaveLength(2);
      expect(plugins.map((p) => p.name)).toContain('plugin-a');
      expect(plugins.map((p) => p.name)).toContain('plugin-b');
      // Should include marketplace source name
      expect(plugins[0].marketplace).toBe('src1');
      expect(plugins[1].marketplace).toBe('src2');
    });

    it('should continue listing even if one source fails', async () => {
      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({ ok: false, status: 500, statusText: 'Server Error' });
        }
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              version: '1.0',
              plugins: [
                {
                  name: 'survivor',
                  title: 'Survivor',
                  description: 'Still here',
                  source: { type: 'github', repo: 'x/x' },
                  tags: [],
                },
              ],
            }),
        });
      });

      const clientWithFetch = new MarketplaceClient({ fetch: mockFetch });
      clientWithFetch.removeSource('claude-plugins-official');
      clientWithFetch.addSource('failing', { type: 'url', url: 'https://fail.com/m.json' });
      clientWithFetch.addSource('working', { type: 'url', url: 'https://work.com/m.json' });

      const plugins = await clientWithFetch.listAvailablePlugins();
      expect(plugins).toHaveLength(1);
      expect(plugins[0].name).toBe('survivor');
    });
  });

  describe('unsupported source types for fetchManifest', () => {
    it('should throw for git source type (not directly fetchable)', async () => {
      client.addSource('git-src', { type: 'git', url: 'https://example.com/repo.git' });
      await expect(client.fetchManifest('git-src')).rejects.toThrow(
        'Source type "git" does not support direct manifest fetching',
      );
    });

    it('should throw for local source type (not directly fetchable)', async () => {
      client.addSource('local-src', { type: 'local', path: '/tmp/plugins' });
      await expect(client.fetchManifest('local-src')).rejects.toThrow(
        'Source type "local" does not support direct manifest fetching',
      );
    });
  });
});
