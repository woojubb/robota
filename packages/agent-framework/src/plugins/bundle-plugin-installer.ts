/**
 * BundlePluginInstaller — installs, uninstalls, enables, and disables bundle plugins.
 *
 * Resolves plugin sources from marketplace manifests, copies/clones to the
 * cache directory, and tracks installations in `installed_plugins.json`.
 */

import { join, dirname } from 'node:path';

import {
  readInstalledPluginsRegistry,
  writeInstalledPluginsRegistry,
} from './installed-plugins-registry.js';
import {
  assertContainedPath,
  PluginPathContainmentError,
  assertSafePluginSegment,
  resolveContainedRelative,
} from './plugin-paths.js';
import { NodeFileSystem } from '../adapters/node-file-system.js';

import type { MarketplaceClient, IMarketplacePluginEntry, TExecFn } from './marketplace-client.js';
import type { NodeHostPluginSettingsStore } from './plugin-settings-store.js';
import type { IFileSystem } from '@robota-sdk/agent-core';

/** Record of an installed plugin in installed_plugins.json. */
export interface IInstalledPluginRecord {
  pluginName: string;
  marketplace: string;
  version: string;
  installPath: string;
  installedAt: string;
}

/** Shape of installed_plugins.json. */
export type TInstalledPluginsRegistry = Record<string, IInstalledPluginRecord>;

/** Options for constructing a BundlePluginInstaller. */
export interface IBundlePluginInstallerOptions {
  /** Base plugins directory (e.g., `~/.robota/plugins`). */
  pluginsDir: string;
  /** Shared settings store for enable/disable persistence. */
  settingsStore: NodeHostPluginSettingsStore;
  /** MarketplaceClient for reading marketplace manifests. */
  marketplaceClient: MarketplaceClient;
  /** Shell exec adapter — must be provided at composition root (e.g., execSync). */
  exec: TExecFn;
  /** File system adapter for testability. */
  fs?: IFileSystem;
}

/** Default git clone timeout in milliseconds (60 seconds). */
const GIT_CLONE_TIMEOUT_MS = 60_000;

/** Installs, uninstalls, enables, and disables bundle plugins. */
export class BundlePluginInstaller {
  private readonly pluginsDir: string;
  private readonly cacheDir: string;
  private readonly registryPath: string;
  private readonly settingsStore: NodeHostPluginSettingsStore;
  private readonly marketplaceClient: MarketplaceClient;
  private readonly exec: TExecFn;
  private readonly fs: IFileSystem;

  constructor(options: IBundlePluginInstallerOptions) {
    this.pluginsDir = options.pluginsDir;
    this.cacheDir = join(this.pluginsDir, 'cache');
    this.registryPath = join(this.pluginsDir, 'installed_plugins.json');
    this.settingsStore = options.settingsStore;
    this.marketplaceClient = options.marketplaceClient;
    this.exec = options.exec;
    this.fs = options.fs ?? new NodeFileSystem();
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

    // SEC-018: all three become path components, and `version` comes from a remote manifest entry.
    // Checked before the join so a malformed value cannot reach any sink — the target is used for a
    // recursive delete during cleanup as well as for the write.
    assertSafePluginSegment(marketplaceName, 'marketplace name');
    assertSafePluginSegment(pluginName, 'plugin name');
    assertSafePluginSegment(version, 'plugin version');

    // Target directory: cache/<marketplace>/<plugin>/<version>/
    const targetDir = join(this.cacheDir, marketplaceName, pluginName, version);
    assertContainedPath(this.cacheDir, targetDir, 'install a plugin', this.fs);

    if (this.fs.existsSync(targetDir)) {
      throw new Error(
        `Plugin "${pluginName}" version "${version}" is already installed from "${marketplaceName}"`,
      );
    }

    // Resolve and install from source
    this.resolveAndInstall(entry.source, marketplaceName, pluginName, targetDir);

    // Record in installed_plugins.json
    const pluginId = `${pluginName}@${marketplaceName}`;
    const registry = readInstalledPluginsRegistry(this.registryPath, this.fs);
    registry[pluginId] = {
      pluginName,
      marketplace: marketplaceName,
      version,
      installPath: targetDir,
      installedAt: new Date().toISOString(),
    };
    writeInstalledPluginsRegistry(this.registryPath, registry, this.fs);
  }

  /**
   * Uninstall a plugin.
   * Removes from cache and from installed_plugins.json.
   */
  async uninstall(pluginId: string): Promise<void> {
    const registry = readInstalledPluginsRegistry(this.registryPath, this.fs);
    const record = registry[pluginId];

    if (!record) {
      throw new Error(`Plugin "${pluginId}" is not installed`);
    }

    // SEC-018: `installPath` is a HINT read from installed_plugins.json, and it drives a recursive
    // delete. The marketplace-wide cleanup guards the identical value/sink pair; this single-plugin
    // path is the SECOND sink on the same value and was missed in the first pass.
    //
    // Refused per entry, as there: the removal is skipped but the registry entry is still dropped, so
    // a tampered record cannot pin itself in place and block every later uninstall.
    if (this.fs.existsSync(record.installPath)) {
      try {
        assertContainedPath(
          this.cacheDir,
          record.installPath,
          'remove a plugin directory',
          this.fs,
        );
        this.fs.rmSync(record.installPath, { recursive: true, force: true });
      } catch (error) {
        // allow-fallback: ONLY a containment refusal is swallowed. A real `rmSync` failure (EACCES,
        // EBUSY) must propagate — dropping the registry entry after one would leave the directory on
        // disk with nothing tracking it, which is worse than the failed uninstall.
        if (!(error instanceof PluginPathContainmentError)) throw error;
        process.stderr.write(`${error.message}\n`);
      }
    }

    // Remove from registry
    delete registry[pluginId];
    writeInstalledPluginsRegistry(this.registryPath, registry, this.fs);

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
  getInstalledPlugins(): TInstalledPluginsRegistry {
    return readInstalledPluginsRegistry(this.registryPath, this.fs);
  }

  /** Get plugins installed from a specific marketplace. */
  getPluginsByMarketplace(marketplaceName: string): IInstalledPluginRecord[] {
    const registry = readInstalledPluginsRegistry(this.registryPath, this.fs);
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
    this.fs.mkdirSync(targetDir, { recursive: true });

    const source = this.normalizeSource(rawSource);

    try {
      if (typeof source === 'string') {
        // SEC-018: `source` comes from the REMOTE marketplace manifest and is joined onto the
        // marketplace clone. `../../../../etc` pointed outside it, and the result is `cpSync`-ed into
        // the plugin cache and then loaded as plugin code.
        const marketplaceDir = this.marketplaceClient.getMarketplaceDir(marketplaceName);
        const sourcePath = resolveContainedRelative(
          marketplaceDir,
          source,
          'install a plugin from a marketplace source',
          this.fs,
        );

        if (!this.fs.existsSync(sourcePath)) {
          throw new Error(
            `Plugin source path "${source}" not found in marketplace "${marketplaceName}"`,
          );
        }

        this.fs.cpSync(sourcePath, targetDir, { recursive: true });
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
      if (this.fs.existsSync(targetDir)) {
        this.fs.rmSync(targetDir, { recursive: true, force: true });
      }
      throw err;
    }
  }

  /** Clone a git repository to the target directory. */
  private cloneToDir(repoUrl: string, targetDir: string, pluginName: string): void {
    // Remove the directory first since mkdirSync already created it
    this.fs.rmSync(targetDir, { recursive: true, force: true });

    try {
      // `--` before the operands: a repository URL beginning with `-` is an OPERAND, not an option.
      this.exec('git', ['clone', '--depth', '1', '--', repoUrl, targetDir], {
        timeout: GIT_CLONE_TIMEOUT_MS,
        stdio: 'pipe',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to clone plugin "${pluginName}": ${message}`);
    }
  }
}
