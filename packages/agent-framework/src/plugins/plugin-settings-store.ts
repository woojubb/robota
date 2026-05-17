/**
 * PluginSettingsStore — single point of read/write for plugin-related settings.
 *
 * Shared by MarketplaceClient and BundlePluginInstaller to prevent
 * concurrent writes from overwriting each other's changes.
 */

import { dirname } from 'node:path';

import { NodeFileSystem } from '../adapters/node-file-system.js';

import type { TMarketplaceSource } from './marketplace-types.js';
import type { IFileSystem } from '@robota-sdk/agent-core';

/** Persisted marketplace source entry. */
export interface IPersistedMarketplaceSource {
  source: TMarketplaceSource;
}

/** Shape of the plugin-related keys in settings.json. */
export interface IPluginSettings {
  enabledPlugins: Record<string, boolean>;
  extraKnownMarketplaces: Record<string, IPersistedMarketplaceSource>;
}

/** Centralized settings store for plugin configuration. */
export class PluginSettingsStore {
  private readonly settingsPath: string;
  private readonly fs: IFileSystem;

  constructor(settingsPath: string, fs: IFileSystem = new NodeFileSystem()) {
    this.settingsPath = settingsPath;
    this.fs = fs;
  }

  /** Read the full settings file from disk. */
  private readAll(): Record<string, unknown> {
    if (!this.fs.existsSync(this.settingsPath)) {
      return {};
    }
    try {
      const raw = this.fs.readFileSync(this.settingsPath, 'utf-8');
      const data: unknown = JSON.parse(raw);
      if (typeof data === 'object' && data !== null) {
        return data as Record<string, unknown>;
      }
      return {};
    } catch {
      // allow-fallback: corrupt settings file returns empty object to allow recovery
      return {};
    }
  }

  /** Write the full settings file to disk. */
  private writeAll(settings: Record<string, unknown>): void {
    const dir = dirname(this.settingsPath);
    if (!this.fs.existsSync(dir)) {
      this.fs.mkdirSync(dir, { recursive: true });
    }
    this.fs.writeFileSync(this.settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
  }

  // --- enabledPlugins ---

  /** Get the enabledPlugins map. */
  getEnabledPlugins(): Record<string, boolean> {
    const settings = this.readAll();
    const ep = settings.enabledPlugins;
    if (typeof ep === 'object' && ep !== null) {
      return ep as Record<string, boolean>;
    }
    return {};
  }

  /** Set a single plugin's enabled state. */
  setPluginEnabled(pluginId: string, enabled: boolean): void {
    const settings = this.readAll();
    const ep = this.getEnabledPluginsFrom(settings);
    ep[pluginId] = enabled;
    settings.enabledPlugins = ep;
    this.writeAll(settings);
  }

  /** Remove a plugin from enabledPlugins. */
  removePluginEntry(pluginId: string): void {
    const settings = this.readAll();
    const ep = this.getEnabledPluginsFrom(settings);
    delete ep[pluginId];
    settings.enabledPlugins = ep;
    this.writeAll(settings);
  }

  // --- extraKnownMarketplaces ---

  /** Get all persisted marketplace sources. */
  getMarketplaceSources(): Record<string, IPersistedMarketplaceSource> {
    const settings = this.readAll();
    const extra = settings.extraKnownMarketplaces;
    if (typeof extra === 'object' && extra !== null) {
      return extra as Record<string, IPersistedMarketplaceSource>;
    }
    return {};
  }

  /** Add or update a marketplace source. */
  setMarketplaceSource(name: string, source: TMarketplaceSource): void {
    const settings = this.readAll();
    const extra = this.getMarketplaceSourcesFrom(settings);
    extra[name] = { source };
    settings.extraKnownMarketplaces = extra;
    this.writeAll(settings);
  }

  /** Remove a marketplace source. */
  removeMarketplaceSource(name: string): void {
    const settings = this.readAll();
    const extra = this.getMarketplaceSourcesFrom(settings);
    delete extra[name];
    settings.extraKnownMarketplaces = extra;
    this.writeAll(settings);
  }

  // --- helpers ---

  private getEnabledPluginsFrom(settings: Record<string, unknown>): Record<string, boolean> {
    const ep = settings.enabledPlugins;
    if (typeof ep === 'object' && ep !== null) {
      return ep as Record<string, boolean>;
    }
    return {};
  }

  private getMarketplaceSourcesFrom(
    settings: Record<string, unknown>,
  ): Record<string, IPersistedMarketplaceSource> {
    const extra = settings.extraKnownMarketplaces;
    if (typeof extra === 'object' && extra !== null) {
      return extra as Record<string, IPersistedMarketplaceSource>;
    }
    return {};
  }
}
