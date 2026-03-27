/**
 * Utility functions for bundle plugin loading.
 *
 * Provides frontmatter parsing, manifest validation, and filesystem helpers
 * used by BundlePluginLoader.
 */

import { existsSync, readdirSync } from 'node:fs';
import type { IBundlePluginManifest } from './bundle-plugin-types.js';

/**
 * Parse simple YAML-like frontmatter from a skill markdown file.
 *
 * Handles `key: value` and `key: [item1, item2]` patterns.
 * Returns the parsed metadata and the remaining content after the frontmatter block.
 */
export function parseSkillFrontmatter(raw: string): {
  metadata: Record<string, unknown>;
  content: string;
} {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith('---')) {
    return { metadata: {}, content: raw };
  }

  const endIndex = trimmed.indexOf('---', 3);
  if (endIndex === -1) {
    return { metadata: {}, content: raw };
  }

  const frontmatterBlock = trimmed.slice(3, endIndex).trim();
  const content = trimmed.slice(endIndex + 3).trimStart();
  const metadata: Record<string, unknown> = {};

  for (const line of frontmatterBlock.split('\n')) {
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const key = line.slice(0, colonIndex).trim();
    let value: unknown = line.slice(colonIndex + 1).trim();

    // Parse inline array: [item1, item2]
    if (typeof value === 'string' && value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1);
      value = inner
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }

    if (key) {
      metadata[key] = value;
    }
  }

  return { metadata, content };
}

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
export function getSortedSubdirs(dirPath: string): string[] {
  if (!existsSync(dirPath)) return [];
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}
