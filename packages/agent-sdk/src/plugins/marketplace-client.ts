/**
 * MarketplaceClient — manages marketplace sources and fetches plugin manifests.
 *
 * Sources are persisted via PluginSettingsStore.
 */

import { PluginSettingsStore } from './plugin-settings-store.js';
import type { IMarketplaceSource } from './plugin-settings-store.js';

// Re-export so consumers don't need to import from plugin-settings-store
export type { IMarketplaceSource };

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
  name?: string;
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
  /** Shared settings store for persistence. */
  settingsStore?: PluginSettingsStore;
  /** Custom fetch implementation for testing. */
  fetch?: (
    url: string,
  ) => Promise<{ ok: boolean; status?: number; statusText?: string; json: () => Promise<unknown> }>;
}

/** Manages marketplace sources and fetches plugin manifests. */
export class MarketplaceClient {
  private readonly sources: Map<string, IMarketplaceSource> = new Map();
  private readonly fetchFn: IMarketplaceClientOptions['fetch'];
  private readonly settingsStore?: PluginSettingsStore;

  constructor(options?: IMarketplaceClientOptions) {
    this.fetchFn = options?.fetch;
    this.settingsStore = options?.settingsStore;

    // Register built-in default marketplace
    this.sources.set('claude-plugins-official', {
      type: 'github',
      repo: 'anthropics/claude-code',
    });

    // Load persisted sources from settings store
    if (this.settingsStore) {
      const persisted = this.settingsStore.getMarketplaceSources();
      for (const [name, entry] of Object.entries(persisted)) {
        if (entry?.source && !this.sources.has(name)) {
          this.sources.set(name, entry.source);
        }
      }
    }
  }

  /** Add a named marketplace source. Persists via settings store. */
  addSource(name: string, source: IMarketplaceSource): void {
    if (this.sources.has(name)) {
      throw new Error(`Marketplace source "${name}" already exists`);
    }
    this.sources.set(name, source);
    this.settingsStore?.setMarketplaceSource(name, source);
  }

  /**
   * Add a marketplace source by fetching its manifest first.
   * Uses the `name` field from the manifest as the registration name.
   * Falls back to the provided fallbackName if manifest has no name.
   * Returns the registered name.
   */
  async addSourceFromManifest(source: IMarketplaceSource, fallbackName: string): Promise<string> {
    const url = this.resolveManifestUrl(source);
    const fetchImpl = this.fetchFn ?? globalThis.fetch;
    const response = await fetchImpl(url);

    if (!response.ok) {
      throw new Error(`Failed to fetch manifest: ${response.status} ${response.statusText}`);
    }

    const manifest = (await response.json()) as IMarketplaceManifest;
    const name = manifest.name ?? fallbackName;

    this.addSource(name, source);
    return name;
  }

  /** Remove a named marketplace source. Persists via settings store. */
  removeSource(name: string): void {
    if (!this.sources.has(name)) {
      throw new Error(`Marketplace source "${name}" not found`);
    }
    this.sources.delete(name);
    this.settingsStore?.removeMarketplaceSource(name);
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
        // Skip failed sources
      }
    }

    return results;
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
