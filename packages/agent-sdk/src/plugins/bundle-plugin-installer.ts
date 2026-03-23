/**
 * BundlePluginInstaller — installs, uninstalls, enables, and disables bundle plugins.
 *
 * Resolves plugin sources from marketplace manifests, copies/clones to the
 * cache directory, and tracks installations in `installed_plugins.json`.
 */

import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { PluginSettingsStore } from './plugin-settings-store.js';
import type { MarketplaceClient, IMarketplacePluginEntry } from './marketplace-client.js';

/** Record of an installed plugin in installed_plugins.json. */
export interface IInstalledPluginRecord {
  pluginName: string;
  marketplace: string;
  version: string;
  installPath: string;
  installedAt: string;
}

/** Shape of installed_plugins.json. */
export type IInstalledPluginsRegistry = Record<string, IInstalledPluginRecord>;

/** Exec function type for running shell commands. */
type ExecFn = (command: string, options: { timeout: number; stdio?: string }) => string | Buffer;

/** Options for constructing a BundlePluginInstaller. */
export interface IBundlePluginInstallerOptions {
  /** Base plugins directory (e.g., `~/.robota/plugins`). */
  pluginsDir: string;
  /** Shared settings store for enable/disable persistence. */
  settingsStore: PluginSettingsStore;
  /** MarketplaceClient for reading marketplace manifests. */
  marketplaceClient: MarketplaceClient;
  /** Custom exec function for testing (replaces child_process.execSync). */
  exec?: ExecFn;
}

/** Default git clone timeout in milliseconds (60 seconds). */
const GIT_CLONE_TIMEOUT_MS = 60_000;

/** Installs, uninstalls, enables, and disables bundle plugins. */
export class BundlePluginInstaller {
  private readonly pluginsDir: string;
  private readonly cacheDir: string;
  private readonly registryPath: string;
  private readonly settingsStore: PluginSettingsStore;
  private readonly marketplaceClient: MarketplaceClient;
  private readonly exec: ExecFn;

  constructor(options: IBundlePluginInstallerOptions) {
    this.pluginsDir = options.pluginsDir;
    this.cacheDir = join(this.pluginsDir, 'cache');
    this.registryPath = join(this.pluginsDir, 'installed_plugins.json');
    this.settingsStore = options.settingsStore;
    this.marketplaceClient = options.marketplaceClient;
    this.exec = options.exec ?? this.defaultExec;
  }

  /**
   * Install a plugin from a marketplace.
   *
   * 1. Read marketplace manifest to find the plugin entry.
   * 2. Resolve source (relative path, github, or url).
   * 3. Copy/clone to `cache/<marketplace>/<plugin>/<version>/`.
   * 4. Record in `installed_plugins.json`.
   */
  async install(pluginName: string, marketplaceName: string): Promise<void> {
    // Read marketplace manifest
    const manifest = this.marketplaceClient.fetchManifest(marketplaceName);
    const entry = manifest.plugins.find((p) => p.name === pluginName);
    if (!entry) {
      throw new Error(`Plugin "${pluginName}" not found in marketplace "${marketplaceName}"`);
    }

    // Determine version
    const version = this.resolveVersion(entry, marketplaceName);

    // Target directory: cache/<marketplace>/<plugin>/<version>/
    const targetDir = join(this.cacheDir, marketplaceName, pluginName, version);

    if (existsSync(targetDir)) {
      throw new Error(
        `Plugin "${pluginName}" version "${version}" is already installed from "${marketplaceName}"`,
      );
    }

    // Resolve and install from source
    this.resolveAndInstall(entry.source, marketplaceName, pluginName, targetDir);

    // Record in installed_plugins.json
    const pluginId = `${pluginName}@${marketplaceName}`;
    const registry = this.readRegistry();
    registry[pluginId] = {
      pluginName,
      marketplace: marketplaceName,
      version,
      installPath: targetDir,
      installedAt: new Date().toISOString(),
    };
    this.writeRegistry(registry);
  }

  /**
   * Uninstall a plugin.
   * Removes from cache and from installed_plugins.json.
   */
  async uninstall(pluginId: string): Promise<void> {
    const registry = this.readRegistry();
    const record = registry[pluginId];

    if (!record) {
      throw new Error(`Plugin "${pluginId}" is not installed`);
    }

    // Remove the installed directory
    if (existsSync(record.installPath)) {
      rmSync(record.installPath, { recursive: true, force: true });
    }

    // Remove from registry
    delete registry[pluginId];
    this.writeRegistry(registry);

    // Remove from enabled plugins settings
    this.settingsStore.removePluginEntry(pluginId);
  }

  /** Enable a plugin by setting its enabledPlugins entry to true. */
  async enable(pluginId: string): Promise<void> {
    this.settingsStore.setPluginEnabled(pluginId, true);
  }

  /** Disable a plugin by setting its enabledPlugins entry to false. */
  async disable(pluginId: string): Promise<void> {
    this.settingsStore.setPluginEnabled(pluginId, false);
  }

  /** Get all installed plugins. */
  getInstalledPlugins(): IInstalledPluginsRegistry {
    return this.readRegistry();
  }

  /** Get plugins installed from a specific marketplace. */
  getPluginsByMarketplace(marketplaceName: string): IInstalledPluginRecord[] {
    const registry = this.readRegistry();
    return Object.values(registry).filter((r) => r.marketplace === marketplaceName);
  }

  // --- Private helpers ---

  /** Resolve the version for a plugin entry. */
  private resolveVersion(entry: IMarketplacePluginEntry, marketplaceName: string): string {
    // If the entry has an explicit version field (the manifest may include it),
    // use it. Otherwise use git SHA.
    const entryWithVersion = entry as unknown as Record<string, unknown>;
    if (typeof entryWithVersion.version === 'string' && entryWithVersion.version) {
      return entryWithVersion.version as string;
    }
    return this.marketplaceClient.getMarketplaceSha(marketplaceName);
  }

  /**
   * Normalize source object — Claude Code manifests use `source` key instead of `type`.
   * e.g., { source: "url", url: "..." } → { type: "url", url: "..." }
   */
  private normalizeSource(
    source: IMarketplacePluginEntry['source'],
  ): IMarketplacePluginEntry['source'] {
    if (typeof source === 'string') return source;
    const obj = source as Record<string, unknown>;
    if (!obj.type && typeof obj.source === 'string') {
      return { ...obj, type: obj.source } as IMarketplacePluginEntry['source'];
    }
    return source;
  }

  /** Resolve the source and install the plugin. */
  private resolveAndInstall(
    rawSource: IMarketplacePluginEntry['source'],
    marketplaceName: string,
    pluginName: string,
    targetDir: string,
  ): void {
    mkdirSync(targetDir, { recursive: true });

    const source = this.normalizeSource(rawSource);

    try {
      if (typeof source === 'string') {
        // Relative path — copy from the marketplace clone
        const marketplaceDir = this.marketplaceClient.getMarketplaceDir(marketplaceName);
        const sourcePath = join(marketplaceDir, source);

        if (!existsSync(sourcePath)) {
          throw new Error(
            `Plugin source path "${source}" not found in marketplace "${marketplaceName}"`,
          );
        }

        cpSync(sourcePath, targetDir, { recursive: true });
      } else if (source.type === 'github') {
        // Clone from GitHub
        const repoUrl = `https://github.com/${source.repo}.git`;
        this.cloneToDir(repoUrl, targetDir, pluginName);
      } else if (
        source.type === 'url' &&
        typeof source.url === 'string' &&
        source.url.endsWith('.git')
      ) {
        // Git URL — clone directly
        this.cloneToDir(source.url, targetDir, pluginName);
      } else if (source.type === 'url') {
        throw new Error(`URL source "${source.url}" is not a git repository (must end with .git)`);
      } else {
        throw new Error(`Unknown source type: ${JSON.stringify(source)}`);
      }
    } catch (err) {
      // Clean up empty target directory on failure
      if (existsSync(targetDir)) {
        rmSync(targetDir, { recursive: true, force: true });
      }
      throw err;
    }
  }

  /** Clone a git repository to the target directory. */
  private cloneToDir(repoUrl: string, targetDir: string, pluginName: string): void {
    // Remove the directory first since mkdirSync already created it
    rmSync(targetDir, { recursive: true, force: true });

    const command = `git clone --depth 1 ${repoUrl} ${targetDir}`;
    try {
      this.exec(command, { timeout: GIT_CLONE_TIMEOUT_MS, stdio: 'pipe' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to clone plugin "${pluginName}": ${message}`);
    }
  }

  /** Read the installed_plugins.json registry. */
  private readRegistry(): IInstalledPluginsRegistry {
    if (!existsSync(this.registryPath)) {
      return {};
    }
    try {
      const raw = readFileSync(this.registryPath, 'utf-8');
      const data: unknown = JSON.parse(raw);
      if (typeof data === 'object' && data !== null) {
        return data as IInstalledPluginsRegistry;
      }
      return {};
    } catch {
      return {};
    }
  }

  /** Write the installed_plugins.json registry. */
  private writeRegistry(registry: IInstalledPluginsRegistry): void {
    const dir = dirname(this.registryPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.registryPath, JSON.stringify(registry, null, 2), 'utf-8');
  }

  /** Default exec implementation using child_process. */
  private defaultExec(command: string, options: { timeout: number }): string | Buffer {
    return execSync(command, { timeout: options.timeout, stdio: 'pipe' });
  }
}
