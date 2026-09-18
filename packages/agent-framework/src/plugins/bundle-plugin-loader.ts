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

import { createLogger } from '@robota-sdk/agent-core';

import {
  inspectHooks,
  inspectMcpConfig,
  SKIP_MESSAGES,
  skipDetail,
} from './bundle-plugin-inspection.js';
import {
  parseSkillFrontmatter,
  validateManifest,
  getSortedSubdirs,
} from './bundle-plugin-utils.js';
import { NodeFileSystem } from '../adapters/node-file-system.js';

import type { IInspectionSink } from './bundle-plugin-inspection.js';
import type {
  IBundlePluginInspection,
  IBundlePluginManifest,
  IBundleSkill,
  ILoadedBundlePlugin,
  TEnabledPlugins,
} from './bundle-plugin-types.js';
import type { IFileSystem, TUniversalValue } from '@robota-sdk/agent-core';

const logger = createLogger('BundlePluginLoader');

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

  /**
   * Load all discovered and enabled bundle plugins (sync).
   *
   * OBSERVABILITY-1991: a projection of {@link inspectPluginsSync} — the discovery runs once and the
   * skipped plugins are reported here by name, out loud, exactly as before; a diagnostic that wants the
   * skip records instead of log lines reads the inspection. Behaviour is unchanged: a plugin whose
   * `hooks/hooks.json` fails the settings hooks schema still loads (report-only; runtime enforcement
   * is a separate item).
   */
  loadPluginsSync(): ILoadedBundlePlugin[] {
    const inspection = this.inspectPluginsSync();
    for (const skip of inspection.skipped) {
      if (skip.reason === 'disabled') continue;
      logger.warn(SKIP_MESSAGES[skip.reason], {
        plugin: skip.pluginId,
        manifestPath: skip.manifestPath,
        ...(skip.detail === undefined ? {} : { error: skip.detail }),
      });
    }
    return [...inspection.loaded];
  }

  /** Load all discovered and enabled bundle plugins (async wrapper). */
  async loadAll(): Promise<ILoadedBundlePlugin[]> {
    return this.loadPluginsSync();
  }

  /**
   * Discover every plugin in the cache directory and classify it: loaded, or skipped with the reason
   * and the manifest path. Read-only; the owner's view a pre-session doctor renders.
   *
   * Directory structure: `<pluginsDir>/cache/<marketplace>/<plugin>/<version>/`
   * For each marketplace/plugin pair, the latest version (lexicographically last) is loaded.
   */
  inspectPluginsSync(): IBundlePluginInspection {
    const cacheDir = join(this.pluginsDir, 'cache');
    const sink: IInspectionSink = {
      loaded: [],
      skipped: [],
      hookIssues: [],
      mcpServers: [],
      mcpFaults: [],
    };
    const cacheDirPresent = this.fs.existsSync(cacheDir);
    if (cacheDirPresent) {
      for (const marketplace of getSortedSubdirs(cacheDir, this.fs)) {
        const marketplaceDir = join(cacheDir, marketplace);
        for (const pluginName of getSortedSubdirs(marketplaceDir, this.fs)) {
          this.inspectPluginDir(marketplace, pluginName, join(marketplaceDir, pluginName), sink);
        }
      }
    }
    return { pluginsDir: this.pluginsDir, cacheDirPresent, ...sink };
  }

  /** Classify one `<marketplace>/<plugin>` directory: its latest version is loaded or skipped by name. */
  private inspectPluginDir(
    marketplace: string,
    pluginName: string,
    pluginDir: string,
    sink: IInspectionSink,
  ): void {
    const versions = getSortedSubdirs(pluginDir, this.fs);
    if (versions.length === 0) return;
    // Use the latest version (lexicographically last)
    const versionDir = join(pluginDir, versions[versions.length - 1]!);
    const manifestPath = join(versionDir, '.claude-plugin', 'plugin.json');
    if (!this.fs.existsSync(manifestPath)) return;

    // CORE-029: one broken plugin used to take down ALL of them. `readManifest` throws on
    // unparseable JSON, that throw escaped discovery, and the caller answered with a bare
    // `catch {}` — so a single malformed manifest silently disabled every installed plugin and the
    // user's hooks just did not run. A plugin that cannot be read is skipped, by name, out loud;
    // its neighbours still load.
    const discoveredId = `${pluginName}@${marketplace}`;
    let manifest: IBundlePluginManifest | null;
    try {
      manifest = this.readManifest(manifestPath);
    } catch (error) {
      const detail = skipDetail(error instanceof Error ? error : undefined);
      sink.skipped.push({
        pluginId: discoveredId,
        manifestPath,
        reason: 'manifest-unreadable',
        detail,
      });
      return;
    }
    if (!manifest) {
      // A structurally invalid manifest was a silent `continue`, which is the same defect with a
      // different cause: the plugin is installed, enabled, and does nothing.
      sink.skipped.push({ pluginId: discoveredId, manifestPath, reason: 'manifest-invalid' });
      return;
    }
    // Check enabled/disabled state using pluginName@marketplace key
    const pluginId = `${manifest.name}@${marketplace}`;
    if (this.isDisabled(pluginId, manifest.name)) {
      sink.skipped.push({ pluginId, manifestPath, reason: 'disabled' });
      return;
    }
    try {
      const plugin = this.loadPlugin(versionDir, manifest);
      sink.loaded.push(plugin);
      inspectHooks(pluginId, versionDir, plugin.hooks, sink.hookIssues);
      inspectMcpConfig(pluginId, versionDir, plugin.mcpConfig, sink);
    } catch (error) {
      const detail = skipDetail(error instanceof Error ? error : undefined);
      sink.skipped.push({ pluginId, manifestPath, reason: 'load-failed', detail });
    }
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
  private loadMcpConfig(pluginDir: string): TUniversalValue | undefined {
    const mcpPath = join(pluginDir, '.mcp.json');
    if (!this.fs.existsSync(mcpPath)) return undefined;

    const raw = this.fs.readFileSync(mcpPath, 'utf-8');
    return JSON.parse(raw) as TUniversalValue;
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
