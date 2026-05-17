/**
 * Marketplace registry I/O helpers.
 *
 * Manages read/write operations for `known_marketplaces.json` and
 * cleanup of installed plugins when a marketplace is removed.
 */

import { join, dirname } from 'node:path';

import { NodeFileSystem } from '../adapters/node-file-system.js';

import type { TKnownMarketplacesRegistry } from './marketplace-types.js';
import type { IFileSystem } from '@robota-sdk/agent-core';

/** Read the known_marketplaces.json registry. Returns empty object if missing or corrupt. */
export function readRegistry(
  registryPath: string,
  fs: IFileSystem = new NodeFileSystem(),
): TKnownMarketplacesRegistry {
  if (!fs.existsSync(registryPath)) {
    return {};
  }
  try {
    const raw = fs.readFileSync(registryPath, 'utf-8');
    const data: unknown = JSON.parse(raw);
    if (typeof data === 'object' && data !== null) {
      return data as TKnownMarketplacesRegistry;
    }
    return {};
  } catch {
    // allow-fallback: corrupt registry file returns empty object to allow recovery
    return {};
  }
}

/** Write the known_marketplaces.json registry, creating parent dirs if needed. */
export function writeRegistry(
  registryPath: string,
  registry: TKnownMarketplacesRegistry,
  fs: IFileSystem = new NodeFileSystem(),
): void {
  const dir = dirname(registryPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf-8');
}

/**
 * Remove all installed plugins that belong to a given marketplace.
 * Reads installed_plugins.json, deletes cache directories for matching plugins,
 * and updates the registry.
 */
export function removeInstalledPluginsForMarketplace(
  pluginsDir: string,
  marketplaceName: string,
  fs: IFileSystem = new NodeFileSystem(),
): void {
  const installedPath = join(pluginsDir, 'installed_plugins.json');
  if (!fs.existsSync(installedPath)) return;

  let registry: Record<string, { marketplace?: string; installPath?: string }>;
  try {
    const raw = fs.readFileSync(installedPath, 'utf-8');
    const data: unknown = JSON.parse(raw);
    if (typeof data !== 'object' || data === null) return;
    registry = data as Record<string, { marketplace?: string; installPath?: string }>;
  } catch {
    // allow-fallback: corrupt installed_plugins.json is skipped, no plugins removed
    return;
  }

  let changed = false;
  for (const [pluginId, record] of Object.entries(registry)) {
    if (record.marketplace === marketplaceName) {
      // Remove the cache directory for this plugin
      if (record.installPath && fs.existsSync(record.installPath)) {
        fs.rmSync(record.installPath, { recursive: true, force: true });
      }
      delete registry[pluginId];
      changed = true;
    }
  }

  if (changed) {
    const dir = dirname(installedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(installedPath, JSON.stringify(registry, null, 2), 'utf-8');
  }
}
