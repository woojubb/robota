/**
 * MarketplaceClient — manages marketplace registries via shallow git clones.
 *
 * Marketplaces are git repositories containing `.claude-plugin/marketplace.json`.
 * They are cloned to `~/.robota/plugins/marketplaces/<name>/` and tracked
 * in `known_marketplaces.json`.
 */

import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  readRegistry,
  writeRegistry,
  removeInstalledPluginsForMarketplace,
} from './marketplace-registry.js';
import type {
  IMarketplaceSource,
  IMarketplacePluginEntry,
  IMarketplaceManifest,
  IMarketplaceClientOptions,
  ExecFn,
} from './marketplace-types.js';

export type {
  IMarketplaceSource,
  IMarketplacePluginEntry,
  IMarketplaceManifest,
  IMarketplaceClientOptions,
  ExecFn,
} from './marketplace-types.js';
export type { IKnownMarketplaceEntry, IKnownMarketplacesRegistry } from './marketplace-types.js';

/** Default git operation timeout in milliseconds (60 seconds). */
const GIT_TIMEOUT_MS = 60_000;

/** Manages marketplace registries via shallow git clones. */
export class MarketplaceClient {
  private readonly pluginsDir: string;
  private readonly exec: ExecFn;
  private readonly marketplacesDir: string;
  private readonly registryPath: string;

  constructor(options: IMarketplaceClientOptions) {
    this.pluginsDir = options.pluginsDir;
    this.exec = options.exec ?? this.defaultExec;
    this.marketplacesDir = join(this.pluginsDir, 'marketplaces');
    this.registryPath = join(this.pluginsDir, 'known_marketplaces.json');
  }

  /**
   * Add a marketplace by cloning its repository.
   *
   * 1. Shallow git clone (`--depth 1`) to `marketplaces/<name>/`.
   * 2. Read `.claude-plugin/marketplace.json` for the `name` field.
   * 3. Register in `known_marketplaces.json`.
   *
   * Returns the registered marketplace name from the manifest.
   */
  addMarketplace(source: IMarketplaceSource): string {
    // Clone to a temp name first, then read the manifest to get the real name
    const tempName = 'temp-' + Date.now().toString(36);
    const tempDir = join(this.marketplacesDir, tempName);

    mkdirSync(this.marketplacesDir, { recursive: true });

    if (source.type === 'local') {
      if (!existsSync(source.path)) {
        throw new Error(`Local marketplace path does not exist: ${source.path}`);
      }
      cpSync(source.path, tempDir, { recursive: true });
    } else {
      const cloneUrl = this.resolveCloneUrl(source);
      const command = `git clone --depth 1 ${cloneUrl} ${tempDir}`;
      try {
        this.exec(command, { timeout: GIT_TIMEOUT_MS, stdio: 'pipe' });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to clone marketplace: ${message}`);
      }
    }

    const manifestPath = join(tempDir, '.claude-plugin', 'marketplace.json');
    if (!existsSync(manifestPath)) {
      rmSync(tempDir, { recursive: true, force: true });
      throw new Error(
        source.type === 'local'
          ? 'Local directory does not contain .claude-plugin/marketplace.json'
          : 'Cloned repository does not contain .claude-plugin/marketplace.json',
      );
    }

    const manifest = this.readManifestFromPath(manifestPath);
    const name = manifest.name;

    if (!name) {
      rmSync(tempDir, { recursive: true, force: true });
      throw new Error('Marketplace manifest does not contain a "name" field');
    }

    const registry = readRegistry(this.registryPath);
    if (registry[name]) {
      rmSync(tempDir, { recursive: true, force: true });
      throw new Error(`Marketplace "${name}" already exists`);
    }

    const finalDir = join(this.marketplacesDir, name);
    renameSync(tempDir, finalDir);

    registry[name] = {
      source,
      installLocation: finalDir,
      lastUpdated: new Date().toISOString(),
    };
    writeRegistry(this.registryPath, registry);

    return name;
  }

  /**
   * Remove a marketplace.
   * Uninstalls all plugins from that marketplace, then deletes the clone directory
   * and removes from the registry.
   */
  removeMarketplace(name: string): void {
    const registry = readRegistry(this.registryPath);
    const entry = registry[name];
    if (!entry) {
      throw new Error(`Marketplace "${name}" not found`);
    }

    removeInstalledPluginsForMarketplace(this.pluginsDir, name);

    if (existsSync(entry.installLocation)) {
      rmSync(entry.installLocation, { recursive: true, force: true });
    }

    delete registry[name];
    writeRegistry(this.registryPath, registry);
  }

  /**
   * Update a marketplace by running git pull on its clone.
   * The manifest is re-read from disk on demand (via fetchManifest), so the
   * updated manifest is automatically available after pull.
   */
  updateMarketplace(name: string): void {
    const registry = readRegistry(this.registryPath);
    const entry = registry[name];
    if (!entry) {
      throw new Error(`Marketplace "${name}" not found`);
    }

    if (!existsSync(entry.installLocation)) {
      throw new Error(`Marketplace directory for "${name}" does not exist`);
    }

    if (entry.source.type === 'local') {
      const localSource = entry.source as { type: 'local'; path: string };
      if (!existsSync(localSource.path)) {
        throw new Error(`Local marketplace path does not exist: ${localSource.path}`);
      }
      rmSync(entry.installLocation, { recursive: true, force: true });
      cpSync(localSource.path, entry.installLocation, { recursive: true });
    } else {
      const command = `git -C ${entry.installLocation} pull`;
      try {
        this.exec(command, { timeout: GIT_TIMEOUT_MS, stdio: 'pipe' });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to update marketplace "${name}": ${message}`);
      }
    }

    entry.lastUpdated = new Date().toISOString();
    writeRegistry(this.registryPath, registry);
  }

  /** List all registered marketplaces. */
  listMarketplaces(): Array<{ name: string; source: IMarketplaceSource; lastUpdated: string }> {
    const registry = readRegistry(this.registryPath);
    return Object.entries(registry).map(([name, entry]) => ({
      name,
      source: entry.source,
      lastUpdated: entry.lastUpdated,
    }));
  }

  /** Read the marketplace manifest from a registered marketplace's clone. */
  fetchManifest(marketplaceName: string): IMarketplaceManifest {
    const registry = readRegistry(this.registryPath);
    const entry = registry[marketplaceName];
    if (!entry) {
      throw new Error(`Marketplace "${marketplaceName}" not found`);
    }

    const manifestPath = join(entry.installLocation, '.claude-plugin', 'marketplace.json');
    if (!existsSync(manifestPath)) {
      throw new Error(
        `Marketplace "${marketplaceName}" does not contain .claude-plugin/marketplace.json`,
      );
    }

    return this.readManifestFromPath(manifestPath);
  }

  /** Get the clone directory path for a registered marketplace. */
  getMarketplaceDir(name: string): string {
    const registry = readRegistry(this.registryPath);
    const entry = registry[name];
    if (!entry) {
      throw new Error(`Marketplace "${name}" not found`);
    }
    return entry.installLocation;
  }

  /**
   * Get the current git SHA (first 12 chars) for a marketplace clone.
   * Used as a version identifier when plugins lack explicit versions.
   */
  getMarketplaceSha(name: string): string {
    const dir = this.getMarketplaceDir(name);
    try {
      const result = this.exec(`git -C ${dir} rev-parse HEAD`, {
        timeout: GIT_TIMEOUT_MS,
        stdio: 'pipe',
      });
      return result.toString().trim().slice(0, 12);
    } catch {
      return 'unknown';
    }
  }

  /** List all available plugins across all marketplaces. */
  listAvailablePlugins(): Array<IMarketplacePluginEntry & { marketplace: string }> {
    const results: Array<IMarketplacePluginEntry & { marketplace: string }> = [];
    const marketplaces = this.listMarketplaces();

    for (const { name } of marketplaces) {
      try {
        const manifest = this.fetchManifest(name);
        for (const plugin of manifest.plugins) {
          results.push({ ...plugin, marketplace: name });
        }
      } catch {
        // Skip failed marketplaces
      }
    }

    return results;
  }

  // --- Private helpers ---

  /** Resolve a marketplace source to a git clone URL. */
  private resolveCloneUrl(source: IMarketplaceSource): string {
    switch (source.type) {
      case 'github':
        return `https://github.com/${source.repo}.git`;
      case 'git':
        return source.url;
      case 'local':
        throw new Error('Local source type does not use git cloning');
      case 'url':
        throw new Error('URL marketplace source is not yet supported');
    }
  }

  /** Read and parse a marketplace.json from a file path. */
  private readManifestFromPath(path: string): IMarketplaceManifest {
    const raw = readFileSync(path, 'utf-8');
    const data: unknown = JSON.parse(raw);

    if (typeof data !== 'object' || data === null) {
      throw new Error('Invalid marketplace manifest: not an object');
    }

    const obj = data as Record<string, unknown>;
    if (typeof obj.name !== 'string') {
      throw new Error('Invalid marketplace manifest: missing "name" field');
    }

    return data as IMarketplaceManifest;
  }

  /** Default exec implementation using child_process. */
  private defaultExec(command: string, options: { timeout: number }): string | Buffer {
    return execSync(command, { timeout: options.timeout, stdio: 'pipe' });
  }
}
