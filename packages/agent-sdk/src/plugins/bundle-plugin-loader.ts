/**
 * BundlePluginLoader — discovers and loads directory-based bundle plugins.
 *
 * Scans the cache directory (`<pluginsDir>/cache/<marketplace>/<plugin>/<version>/`)
 * for subdirectories containing `.claude-plugin/plugin.json`,
 * reads manifests, loads skills (with frontmatter parsing), hooks, and agent definitions.
 *
 * For each plugin, the latest version directory (lexicographically last) is loaded.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  IBundlePluginManifest,
  IBundleSkill,
  ILoadedBundlePlugin,
  TEnabledPlugins,
} from './bundle-plugin-types.js';

/**
 * Parse simple YAML-like frontmatter from a skill markdown file.
 *
 * Handles `key: value` and `key: [item1, item2]` patterns.
 * Returns the parsed metadata and the remaining content after the frontmatter block.
 */
function parseSkillFrontmatter(raw: string): {
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
function validateManifest(data: unknown): IBundlePluginManifest | null {
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
function getSortedSubdirs(dirPath: string): string[] {
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

/** Loader for directory-based bundle plugins from the cache directory. */
export class BundlePluginLoader {
  private readonly pluginsDir: string;
  private readonly enabledPlugins: TEnabledPlugins;

  constructor(pluginsDir: string, enabledPlugins?: TEnabledPlugins) {
    this.pluginsDir = pluginsDir;
    this.enabledPlugins = enabledPlugins ?? {};
  }

  /** Load all discovered and enabled bundle plugins (sync). */
  loadPluginsSync(): ILoadedBundlePlugin[] {
    return this.discoverAndLoad();
  }

  /** Load all discovered and enabled bundle plugins (async wrapper). */
  async loadAll(): Promise<ILoadedBundlePlugin[]> {
    return this.discoverAndLoad();
  }

  /**
   * Discover and load plugins from the cache directory.
   *
   * Directory structure: `<pluginsDir>/cache/<marketplace>/<plugin>/<version>/`
   * For each marketplace/plugin pair, the latest version (lexicographically last) is loaded.
   */
  private discoverAndLoad(): ILoadedBundlePlugin[] {
    const cacheDir = join(this.pluginsDir, 'cache');
    if (!existsSync(cacheDir)) {
      return [];
    }

    const results: ILoadedBundlePlugin[] = [];

    // Iterate marketplaces
    const marketplaces = getSortedSubdirs(cacheDir);
    for (const marketplace of marketplaces) {
      const marketplaceDir = join(cacheDir, marketplace);
      const plugins = getSortedSubdirs(marketplaceDir);

      for (const pluginName of plugins) {
        const pluginDir = join(marketplaceDir, pluginName);
        const versions = getSortedSubdirs(pluginDir);

        if (versions.length === 0) continue;

        // Use the latest version (lexicographically last)
        const latestVersion = versions[versions.length - 1];
        const versionDir = join(pluginDir, latestVersion);

        const manifestPath = join(versionDir, '.claude-plugin', 'plugin.json');
        if (!existsSync(manifestPath)) continue;

        const manifest = this.readManifest(manifestPath);
        if (!manifest) continue;

        // Check enabled/disabled state using pluginName@marketplace key
        const pluginId = `${manifest.name}@${marketplace}`;
        if (this.isDisabled(pluginId, manifest.name)) continue;

        const loaded = this.loadPlugin(versionDir, manifest);
        results.push(loaded);
      }
    }

    return results;
  }

  /** Read and validate a plugin.json manifest. Returns null on failure. */
  private readManifest(path: string): IBundlePluginManifest | null {
    try {
      const raw = readFileSync(path, 'utf-8');
      const data: unknown = JSON.parse(raw);
      return validateManifest(data);
    } catch {
      return null;
    }
  }

  /**
   * Check if a plugin is explicitly disabled.
   * Checks both `name@marketplace` and `name` keys.
   * Plugins not listed in enabledPlugins are enabled by default.
   */
  private isDisabled(pluginId: string, pluginName: string): boolean {
    if (pluginId in this.enabledPlugins) {
      return this.enabledPlugins[pluginId] === false;
    }
    if (pluginName in this.enabledPlugins) {
      return this.enabledPlugins[pluginName] === false;
    }

    return false;
  }

  /** Load a single plugin's skills, hooks, agents, and MCP config. */
  private loadPlugin(pluginDir: string, manifest: IBundlePluginManifest): ILoadedBundlePlugin {
    return {
      manifest,
      skills: this.loadSkills(pluginDir, manifest.name),
      commands: this.loadCommands(pluginDir, manifest.name),
      hooks: this.loadHooks(pluginDir),
      mcpConfig: this.loadMcpConfig(pluginDir),
      agents: this.loadAgents(pluginDir),
      pluginDir,
    };
  }

  /** Load skills from the plugin's skills/ directory. */
  private loadSkills(pluginDir: string, pluginName: string): IBundleSkill[] {
    const skillsDir = join(pluginDir, 'skills');
    if (!existsSync(skillsDir)) return [];

    const entries = readdirSync(skillsDir, { withFileTypes: true });
    const skills: IBundleSkill[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillFile = join(skillsDir, entry.name, 'SKILL.md');
      if (!existsSync(skillFile)) continue;

      const raw = readFileSync(skillFile, 'utf-8');
      const { metadata, content } = parseSkillFrontmatter(raw);

      const description = typeof metadata.description === 'string' ? metadata.description : '';

      const skill: IBundleSkill = {
        name: entry.name,
        description,
        skillContent: content,
        ...metadata,
      };

      skills.push(skill);
    }

    return skills;
  }

  /** Load commands from the plugin's commands/ directory (flat .md files). */
  private loadCommands(pluginDir: string, pluginName: string): IBundleSkill[] {
    const commandsDir = join(pluginDir, 'commands');
    if (!existsSync(commandsDir)) return [];

    const entries = readdirSync(commandsDir, { withFileTypes: true });
    const commands: IBundleSkill[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

      const raw = readFileSync(join(commandsDir, entry.name), 'utf-8');
      const { metadata, content } = parseSkillFrontmatter(raw);

      const name =
        typeof metadata.name === 'string' ? metadata.name : entry.name.replace(/\.md$/, '');
      const description = typeof metadata.description === 'string' ? metadata.description : '';

      commands.push({
        ...metadata,
        name: `${pluginName}:${name}`,
        description,
        skillContent: content,
      });
    }

    return commands;
  }

  /** Load hooks from hooks/hooks.json if present. */
  private loadHooks(pluginDir: string): Record<string, unknown> {
    const hooksPath = join(pluginDir, 'hooks', 'hooks.json');
    if (!existsSync(hooksPath)) return {};

    try {
      const raw = readFileSync(hooksPath, 'utf-8');
      const data: unknown = JSON.parse(raw);
      if (typeof data === 'object' && data !== null) {
        return data as Record<string, unknown>;
      }
      return {};
    } catch {
      return {};
    }
  }

  /** Load MCP server configuration if present. Checks `.mcp.json` at plugin root first. */
  private loadMcpConfig(pluginDir: string): unknown | undefined {
    // Primary location: .mcp.json at plugin root (Claude Code standard)
    const primaryPath = join(pluginDir, '.mcp.json');
    // Fallback: .claude-plugin/mcp.json (legacy location)
    const fallbackPath = join(pluginDir, '.claude-plugin', 'mcp.json');
    const mcpPath = existsSync(primaryPath) ? primaryPath : fallbackPath;
    if (!existsSync(mcpPath)) return undefined;

    try {
      const raw = readFileSync(mcpPath, 'utf-8');
      return JSON.parse(raw) as unknown;
    } catch {
      return undefined;
    }
  }

  /** Load agent definitions from agents/ directory if present. */
  private loadAgents(pluginDir: string): string[] {
    const agentsDir = join(pluginDir, 'agents');
    if (!existsSync(agentsDir)) return [];

    try {
      const entries = readdirSync(agentsDir, { withFileTypes: true });
      return entries
        .filter((e) => e.isDirectory() || e.name.endsWith('.md'))
        .map((e) => e.name.replace(/\.md$/, ''));
    } catch {
      return [];
    }
  }
}
