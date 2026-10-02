/**
 * Utility functions for bundle plugin loading.
 *
 * Provides manifest validation and filesystem helpers
 * used by BundlePluginLoader.
 */

import { NodeFileSystem } from '../adapters/node-file-system.js';

import type { IBundlePluginManifest } from './bundle-plugin-types.js';
import type { IFileSystem, TUniversalValue } from '@robota-sdk/agent-core';

/**
 * Validate that a parsed JSON object has the required manifest fields.
 * Returns the typed manifest or null if invalid.
 */
export function validateManifest(data: unknown): IBundlePluginManifest | null {
  if (typeof data !== 'object' || data === null) return null;

  const obj = data as Record<string, unknown>;
  if (typeof obj.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(obj.name)) return null;
  if (obj.version !== undefined && typeof obj.version !== 'string') return null;
  if (obj.description !== undefined && typeof obj.description !== 'string') return null;

  const features =
    typeof obj.features === 'object' && obj.features !== null
      ? (obj.features as Record<string, unknown>)
      : {};

  return {
    name: obj.name,
    ...(typeof obj.version === 'string' ? { version: obj.version } : {}),
    ...(typeof obj.description === 'string' ? { description: obj.description } : {}),
    ...Object.fromEntries(
      ['commands', 'skills', 'hooks', 'agents']
        .filter((key) => Object.hasOwn(obj, key))
        .map((key) => [key, obj[key] as TUniversalValue]),
    ),
    ...(obj.mcpServers !== undefined ? { mcpServers: obj.mcpServers as TUniversalValue } : {}),
    features: {
      commands: features.commands === true ? true : undefined,
      agents: features.agents === true ? true : undefined,
      skills: features.skills === true ? true : undefined,
      hooks: features.hooks === true ? true : undefined,
      mcp: features.mcp === true ? true : undefined,
    },
  };
}

/**
 * Get sorted subdirectories from a directory.
 * Returns directory names sorted lexicographically.
 */
export function getSortedSubdirs(
  dirPath: string,
  fs: IFileSystem = new NodeFileSystem(),
): string[] {
  if (!fs.existsSync(dirPath)) return [];
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    // allow-fallback: unreadable directory returns empty list to allow plugin discovery to continue
    return [];
  }
}
