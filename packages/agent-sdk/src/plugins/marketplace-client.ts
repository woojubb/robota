/**
 * MarketplaceClient — manages marketplace sources and fetches plugin manifests.
 *
 * Sources are persisted to a settings file (e.g., ~/.robota/settings.json)
 * under the `extraKnownMarketplaces` key.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/** Source type for a marketplace registry. */
export type IMarketplaceSource =
  | { type: 'github'; repo: string; ref?: string }
  | { type: 'git'; url: string; ref?: string }
  | { type: 'local'; path: string }
  | { type: 'url'; url: string };

/** A single plugin entry in a marketplace manifest. */
export interface IMarketplacePluginEntry {
  name: string;
  title: string;
  description: string;
  source: IMarketplaceSource;
  tags: string[];
  /** The marketplace source this entry came from. */
  marketplace: string;
}

/** Manifest format returned by a marketplace source. */
export interface IMarketplaceManifest {
  version: string;
  plugins: Array<{
    name: string;
    title: string;
    description: string;
    source: IMarketplaceSource;
    tags: string[];
  }>;
}

/** Options for constructing a MarketplaceClient. */
export interface IMarketplaceClientOptions {
  /** Path to settings file for persisting marketplace sources. */
  settingsPath?: string;
  /** Custom fetch implementation for testing. */
  fetch?: (
    url: string,
  ) => Promise<{ ok: boolean; status?: number; statusText?: string; json: () => Promise<unknown> }>;
}

/** Serialized marketplace source entry in settings. */
interface IPersistedSource {
  source: IMarketplaceSource;
}

/** Manages marketplace sources and fetches plugin manifests. */
export class MarketplaceClient {
  private readonly sources: Map<string, IMarketplaceSource> = new Map();
  private readonly fetchFn: IMarketplaceClientOptions['fetch'];
  private readonly settingsPath?: string;

  constructor(options?: IMarketplaceClientOptions) {
    this.fetchFn = options?.fetch;
    this.settingsPath = options?.settingsPath;

    // Register built-in default marketplace
    this.sources.set('claude-plugins-official', {
      type: 'github',
      repo: 'anthropics/claude-code',
    });

    // Load persisted sources from settings
    this.loadPersistedSources();
  }

  /** Add a named marketplace source. Persists to settings file. */
  addSource(name: string, source: IMarketplaceSource): void {
    if (this.sources.has(name)) {
      throw new Error(`Marketplace source "${name}" already exists`);
    }
    this.sources.set(name, source);
    this.persistSources();
  }

  /** Remove a named marketplace source. Persists to settings file. */
  removeSource(name: string): void {
    if (!this.sources.has(name)) {
      throw new Error(`Marketplace source "${name}" not found`);
    }
    this.sources.delete(name);
    this.persistSources();
  }

  /** List all registered marketplace sources. */
  listSources(): Array<{ name: string; source: IMarketplaceSource }> {
    const result: Array<{ name: string; source: IMarketplaceSource }> = [];
    for (const [name, source] of this.sources) {
      result.push({ name, source });
    }
    return result;
  }

  /** Fetch a manifest from a named marketplace source. */
  async fetchManifest(sourceName: string): Promise<IMarketplaceManifest> {
    const source = this.sources.get(sourceName);
    if (!source) {
      throw new Error(`Marketplace source "${sourceName}" not found`);
    }

    const url = this.resolveManifestUrl(source);
    const fetchImpl = this.fetchFn ?? globalThis.fetch;
    const response = await fetchImpl(url);

    if (!response.ok) {
      throw new Error(
        `Failed to fetch manifest from "${sourceName}": ${response.status} ${response.statusText}`,
      );
    }

    return (await response.json()) as IMarketplaceManifest;
  }

  /** List all available plugins across all sources. Skips failed sources. */
  async listAvailablePlugins(): Promise<IMarketplacePluginEntry[]> {
    const results: IMarketplacePluginEntry[] = [];
    const sources = this.listSources();

    for (const { name, source } of sources) {
      // Only github and url types support direct fetching
      if (source.type !== 'github' && source.type !== 'url') {
        continue;
      }

      try {
        const manifest = await this.fetchManifest(name);
        for (const plugin of manifest.plugins) {
          results.push({
            ...plugin,
            marketplace: name,
          });
        }
      } catch {
        // Skip failed sources — continue with remaining
      }
    }

    return results;
  }

  /** Load marketplace sources from settings file. */
  private loadPersistedSources(): void {
    if (!this.settingsPath) return;

    try {
      const raw = readFileSync(this.settingsPath, 'utf-8');
      const settings = JSON.parse(raw) as Record<string, unknown>;
      const extra = settings.extraKnownMarketplaces as Record<string, IPersistedSource> | undefined;
      if (!extra || typeof extra !== 'object') return;

      for (const [name, entry] of Object.entries(extra)) {
        if (entry?.source && !this.sources.has(name)) {
          this.sources.set(name, entry.source);
        }
      }
    } catch {
      // File doesn't exist or invalid — start fresh
    }
  }

  /** Persist user-added marketplace sources to settings file. */
  private persistSources(): void {
    if (!this.settingsPath) return;

    // Read existing settings
    let settings: Record<string, unknown> = {};
    try {
      const raw = readFileSync(this.settingsPath, 'utf-8');
      settings = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // File doesn't exist — will create
    }

    // Build extraKnownMarketplaces (exclude built-in default)
    const extra: Record<string, IPersistedSource> = {};
    for (const [name, source] of this.sources) {
      if (name === 'claude-plugins-official') continue;
      extra[name] = { source };
    }

    settings.extraKnownMarketplaces = extra;

    // Write back
    mkdirSync(dirname(this.settingsPath), { recursive: true });
    writeFileSync(this.settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
  }

  /** Resolve a marketplace source to a manifest URL. */
  private resolveManifestUrl(source: IMarketplaceSource): string {
    switch (source.type) {
      case 'github': {
        const ref = source.ref ?? 'main';
        return `https://raw.githubusercontent.com/${source.repo}/${ref}/.claude-plugin/marketplace.json`;
      }
      case 'url':
        return source.url;
      case 'git':
        throw new Error('Source type "git" does not support direct manifest fetching');
      case 'local':
        throw new Error('Source type "local" does not support direct manifest fetching');
    }
  }
}
