/**
 * BundlePluginLoader — discovers and loads directory-based bundle plugins.
 *
 * Scans the cache directory (`<pluginsDir>/cache/<marketplace>/<plugin>/<version>/`)
 * for subdirectories containing `.claude-plugin/plugin.json`,
 * reads manifests, loads skills (with frontmatter parsing), hooks, and agent definitions.
 *
 * For each plugin, the latest version directory (lexicographically last) is loaded.
 */

import { join } from 'node:path';
import type { IFileSystem } from '@robota-sdk/agent-core';
import { NodeFileSystem } from '../adapters/node-file-system.js';
import type {
  IBundlePluginManifest,
  IBundleSkill,
  ILoadedBundlePlugin,
  TEnabledPlugins,
} from './bundle-plugin-types.js';
import {
  parseSkillFrontmatter,
  validateManifest,
  getSortedSubdirs,
} from './bundle-plugin-utils.js';

/** Loader for directory-based bundle plugins from the cache directory. */
export class BundlePluginLoader {
  private readonly pluginsDir: string;
  private readonly enabledPlugins: TEnabledPlugins;
  private readonly fs: IFileSystem;

  constructor(
    pluginsDir: string,
    enabledPlugins?: TEnabledPlugins,
    fs: IFileSystem = new NodeFileSystem(),
  ) {
    this.pluginsDir = pluginsDir;
    this.enabledPlugins = enabledPlugins ?? {};
    this.fs = fs;
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
    if (!this.fs.existsSync(cacheDir)) {
      return [];
    }

    const results: ILoadedBundlePlugin[] = [];

    // Iterate marketplaces
    const marketplaces = getSortedSubdirs(cacheDir, this.fs);
    for (const marketplace of marketplaces) {
      const marketplaceDir = join(cacheDir, marketplace);
      const plugins = getSortedSubdirs(marketplaceDir, this.fs);

      for (const pluginName of plugins) {
        const pluginDir = join(marketplaceDir, pluginName);
        const versions = getSortedSubdirs(pluginDir, this.fs);

        if (versions.length === 0) continue;

        // Use the latest version (lexicographically last)
        const latestVersion = versions[versions.length - 1];
        const versionDir = join(pluginDir, latestVersion);

        const manifestPath = join(versionDir, '.claude-plugin', 'plugin.json');
        if (!this.fs.existsSync(manifestPath)) continue;

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

  /** Read and validate a plugin.json manifest. Returns null if the manifest structure is invalid. */
  private readManifest(path: string): IBundlePluginManifest | null {
    const raw = this.fs.readFileSync(path, 'utf-8');
    const data: unknown = JSON.parse(raw);
    return validateManifest(data);
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
    if (!this.fs.existsSync(skillsDir)) return [];

    const entries = this.fs.readdirSync(skillsDir, { withFileTypes: true });
    const skills: IBundleSkill[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillFile = join(skillsDir, entry.name, 'SKILL.md');
      if (!this.fs.existsSync(skillFile)) continue;

      const raw = this.fs.readFileSync(skillFile, 'utf-8');
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
    if (!this.fs.existsSync(commandsDir)) return [];

    const entries = this.fs.readdirSync(commandsDir, { withFileTypes: true });
    const commands: IBundleSkill[] = [];

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

      const raw = this.fs.readFileSync(join(commandsDir, entry.name), 'utf-8');
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
    if (!this.fs.existsSync(hooksPath)) return {};

    const raw = this.fs.readFileSync(hooksPath, 'utf-8');
    const data: unknown = JSON.parse(raw);
    if (typeof data === 'object' && data !== null) {
      return data as Record<string, unknown>;
    }
    return {};
  }

  /** Load MCP server configuration from `.mcp.json` at the plugin root if present. */
  private loadMcpConfig(pluginDir: string): unknown | undefined {
    const mcpPath = join(pluginDir, '.mcp.json');
    if (!this.fs.existsSync(mcpPath)) return undefined;

    const raw = this.fs.readFileSync(mcpPath, 'utf-8');
    return JSON.parse(raw) as unknown;
  }

  /** Load agent definitions from agents/ directory if present. */
  private loadAgents(pluginDir: string): string[] {
    const agentsDir = join(pluginDir, 'agents');
    if (!this.fs.existsSync(agentsDir)) return [];

    const entries = this.fs.readdirSync(agentsDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() || e.name.endsWith('.md'))
      .map((e) => e.name.replace(/\.md$/, ''));
  }
}
