/**
 * Utility functions for bundle plugin loading.
 *
 * Provides manifest validation and filesystem helpers
 * used by BundlePluginLoader.
 */

import { NodeFileSystem } from '../adapters/node-file-system.js';

import type { IBundlePluginManifest } from './bundle-plugin-types.js';
import type { IFileSystem } from '@robota-sdk/agent-core';

/**
 * Validate that a parsed JSON object has the required manifest fields.
 * Returns the typed manifest or null if invalid.
 */
export function validateManifest(data: unknown): IBundlePluginManifest | null {
  if (typeof data !== 'object' || data === null) return null;

  const obj = data as Record<string, unknown>;
  if (typeof obj.name !== 'string') return null;
  if (typeof obj.version !== 'string') return null;
  if (typeof obj.description !== 'string') return null;

  const features =
    typeof obj.features === 'object' && obj.features !== null
      ? (obj.features as Record<string, unknown>)
      : {};

  return {
    name: obj.name,
    version: obj.version,
    description: obj.description,
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
