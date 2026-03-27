/**
 * Marketplace registry I/O helpers.
 *
 * Manages read/write operations for `known_marketplaces.json` and
 * cleanup of installed plugins when a marketplace is removed.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { IKnownMarketplacesRegistry } from './marketplace-types.js';

/** Read the known_marketplaces.json registry. Returns empty object if missing or corrupt. */
export function readRegistry(registryPath: string): IKnownMarketplacesRegistry {
  if (!existsSync(registryPath)) {
    return {};
  }
  try {
    const raw = readFileSync(registryPath, 'utf-8');
    const data: unknown = JSON.parse(raw);
    if (typeof data === 'object' && data !== null) {
      return data as IKnownMarketplacesRegistry;
    }
    return {};
  } catch {
    return {};
  }
}

/** Write the known_marketplaces.json registry, creating parent dirs if needed. */
export function writeRegistry(registryPath: string, registry: IKnownMarketplacesRegistry): void {
  const dir = dirname(registryPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(registryPath, JSON.stringify(registry, null, 2), 'utf-8');
}

/**
 * Remove all installed plugins that belong to a given marketplace.
 * Reads installed_plugins.json, deletes cache directories for matching plugins,
 * and updates the registry.
 */
export function removeInstalledPluginsForMarketplace(
  pluginsDir: string,
  marketplaceName: string,
): void {
  const installedPath = join(pluginsDir, 'installed_plugins.json');
  if (!existsSync(installedPath)) return;

  let registry: Record<string, { marketplace?: string; installPath?: string }>;
  try {
    const raw = readFileSync(installedPath, 'utf-8');
    const data: unknown = JSON.parse(raw);
    if (typeof data !== 'object' || data === null) return;
    registry = data as Record<string, { marketplace?: string; installPath?: string }>;
  } catch {
    return;
  }

  let changed = false;
  for (const [pluginId, record] of Object.entries(registry)) {
    if (record.marketplace === marketplaceName) {
      // Remove the cache directory for this plugin
      if (record.installPath && existsSync(record.installPath)) {
        rmSync(record.installPath, { recursive: true, force: true });
      }
      delete registry[pluginId];
      changed = true;
    }
  }

  if (changed) {
    const dir = dirname(installedPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(installedPath, JSON.stringify(registry, null, 2), 'utf-8');
  }
}
