/**
 * BundlePluginLoader — discovers and loads directory-based bundle plugins.
 *
 * Scans the cache directory (`<pluginsDir>/cache/<marketplace>/<plugin>/<version>/`)
 * for subdirectories containing `.claude-plugin/plugin.json`,
 * reads manifests, loads skills (with frontmatter parsing), hooks, and agent definitions.
 *
 * Each plugin loads its installed revision; an unregistered single revision is supported.
 */

import { join, resolve } from 'node:path';
import { assertContainedPath, assertSafePluginSegment } from './plugin-paths.js';

import { createLogger } from '@robota-sdk/agent-core';

import {
  inspectHooks,
  inspectMcpConfig,
  SKIP_MESSAGES,
  skipDetail,
} from './bundle-plugin-inspection.js';
import { validateManifest, getSortedSubdirs } from './bundle-plugin-utils.js';
import { NodeFileSystem } from '../adapters/node-file-system.js';
import { decodeFrontmatter } from '../frontmatter/frontmatter-decoder.js';
import { FrontmatterDecodeError } from '../frontmatter/frontmatter-error.js';
import { describeBundleContribution } from '../contributions/bundle-contribution-descriptor.js';
import { loadDeclaredMcpConfig } from './declared-mcp-config.js';

import type { IInspectionSink } from './bundle-plugin-inspection.js';
import type {
  IBundlePluginInspection,
  IBundlePluginManifest,
  IBundleSkill,
  ILoadedBundlePlugin,
  TEnabledPlugins,
} from './bundle-plugin-types.js';
import type { IBundleSkillFrontmatter } from '../frontmatter/frontmatter-types.js';
import type { IFileSystem } from '@robota-sdk/agent-core';

const logger = createLogger('BundlePluginLoader');

interface IInstalledSelection {
  records?: Record<string, unknown>;
  error?: Error;
}

interface IDecodedBundleSkill {
  metadata: IBundleSkillFrontmatter;
  body: string;
}

function decodeBundleSkill(source: string, raw: string): IDecodedBundleSkill {
  const result = decodeFrontmatter({ source, content: raw, profile: 'bundle-skill' });
  if (!result.ok) throw new FrontmatterDecodeError(result.diagnostics);
  return result;
}

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
   * Installed records select revisions; ambiguous unregistered caches are refused.
   */
  inspectPluginsSync(): IBundlePluginInspection {
    const cacheDir = join(this.pluginsDir, 'cache');
    const selection = this.snapshotInstalledSelection();
    const discovered = new Set<string>();
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
          discovered.add(`${pluginName}@${marketplace}`);
          this.inspectPluginDir(
            marketplace,
            pluginName,
            join(marketplaceDir, pluginName),
            sink,
            selection,
          );
        }
      }
    }
    for (const pluginId of Object.keys(selection.records ?? {})) {
      if (!discovered.has(pluginId)) {
        sink.skipped.push({
          pluginId,
          manifestPath: join(this.pluginsDir, 'installed_plugins.json'),
          reason: 'revision-unselected',
          detail: 'Selected plugin source is missing from cache',
        });
      }
    }
    if (selection.error && discovered.size === 0) {
      sink.skipped.push({
        pluginId: 'installed_plugins.json',
        manifestPath: join(this.pluginsDir, 'installed_plugins.json'),
        reason: 'revision-unselected',
        detail: skipDetail(selection.error),
      });
    }
    return { pluginsDir: this.pluginsDir, cacheDirPresent, ...sink };
  }

  /** Classify one selected installed source without guessing between cached revisions. */
  private inspectPluginDir(
    marketplace: string,
    pluginName: string,
    pluginDir: string,
    sink: IInspectionSink,
    selection: IInstalledSelection,
  ): void {
    const versions = getSortedSubdirs(pluginDir, this.fs);
    const discoveredId = `${pluginName}@${marketplace}`;
    let versionDir: string;
    try {
      versionDir = this.selectRevision(pluginDir, marketplace, pluginName, versions, selection);
    } catch (error) {
      sink.skipped.push({
        pluginId: discoveredId,
        manifestPath: join(pluginDir, '.claude-plugin', 'plugin.json'),
        reason: 'revision-unselected',
        detail: skipDetail(error instanceof Error ? error : undefined),
      });
      return;
    }
    const manifestPath = join(versionDir, '.claude-plugin', 'plugin.json');

    // CORE-029: one broken plugin used to take down ALL of them. `readManifest` throws on
    // unparseable JSON, that throw escaped discovery, and the caller answered with a bare
    // `catch {}` — so a single malformed manifest silently disabled every installed plugin and the
    // user's hooks just did not run. A plugin that cannot be read is skipped, by name, out loud;
    // its neighbours still load.
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
    if (this.isDisabled(discoveredId, pluginName) || this.isDisabled(pluginId, manifest.name)) {
      sink.skipped.push({ pluginId, manifestPath, reason: 'disabled' });
      return;
    }
    try {
      const plugin = this.loadPlugin(versionDir, manifest);
      plugin.descriptor = describeBundleContribution(plugin, discoveredId);
      sink.loaded.push(plugin);
      inspectHooks(pluginId, versionDir, plugin.hooks, sink.hookIssues);
      inspectMcpConfig(pluginId, versionDir, plugin.mcpConfig, sink, plugin.mcpSourcePaths);
    } catch (error) {
      const detail = skipDetail(error instanceof Error ? error : undefined);
      sink.skipped.push({ pluginId, manifestPath, reason: 'load-failed', detail });
    }
  }

  private snapshotInstalledSelection(): IInstalledSelection {
    const registryPath = join(this.pluginsDir, 'installed_plugins.json');
    if (!this.fs.existsSync(registryPath)) return {};
    try {
      const records: unknown = JSON.parse(this.fs.readFileSync(registryPath, 'utf-8'));
      if (typeof records !== 'object' || records === null || Array.isArray(records))
        throw new Error('Invalid installed registry');
      return { records: records as Record<string, unknown> };
    } catch (error) {
      return { error: error instanceof Error ? error : new Error('Invalid installed registry') };
    }
  }

  private selectRevision(
    pluginDir: string,
    marketplace: string,
    pluginName: string,
    versions: string[],
    selection: IInstalledSelection,
  ): string {
    if (selection.error) throw selection.error;
    let revision: string;
    if (!selection.records) {
      if (versions.length !== 1)
        throw new Error('Select an installed revision before loading multiple cached sources');
      revision = versions[0]!;
    } else {
      const record = Object.hasOwn(selection.records, `${pluginName}@${marketplace}`)
        ? selection.records[`${pluginName}@${marketplace}`]
        : undefined;
      if (typeof record !== 'object' || record === null || Array.isArray(record))
        throw new Error('No selected installation');
      const fields = record as Record<string, unknown>;
      assertSafePluginSegment(fields.version, 'installed revision');
      revision = fields.version;
      if (
        fields.pluginName !== pluginName ||
        fields.marketplace !== marketplace ||
        typeof fields.installPath !== 'string' ||
        resolve(fields.installPath) !== resolve(pluginDir, revision)
      )
        throw new Error('Installed record does not match its cached source');
    }
    assertSafePluginSegment(revision, 'source revision');
    const selected = join(pluginDir, revision);
    if (!versions.includes(revision)) throw new Error('Selected revision is not installed');
    assertContainedPath(join(this.pluginsDir, 'cache'), selected, 'load installed source', this.fs);
    assertContainedPath(pluginDir, selected, 'load selected plugin revision', this.fs);
    assertContainedPath(
      selected,
      join(selected, '.claude-plugin', 'plugin.json'),
      'read plugin manifest',
      this.fs,
    );
    return selected;
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
    let mcpSourcePaths: Record<string, string> = {};
    const mcpConfig = loadDeclaredMcpConfig(
      pluginDir,
      manifest.mcpServers,
      this.fs,
      (name, path) => {
        mcpSourcePaths = { ...mcpSourcePaths, [name]: path };
      },
    );
    return {
      manifest,
      skills: this.loadSkills(pluginDir, manifest.name),
      commands: this.loadCommands(pluginDir, manifest.name),
      hooks: this.loadHooks(pluginDir),
      mcpConfig,
      mcpSourcePaths,
      agents: this.loadAgents(pluginDir),
      pluginDir,
    };
  }

  /** Load skills from the plugin's skills/ directory. */
  private loadSkills(pluginDir: string, _pluginName: string): IBundleSkill[] {
    const skillsDir = join(pluginDir, 'skills');
    if (!this.fs.existsSync(skillsDir)) return [];

    const entries = this.fs.readdirSync(skillsDir, { withFileTypes: true });
    const skills: IBundleSkill[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillFile = join(skillsDir, entry.name, 'SKILL.md');
      if (!this.fs.existsSync(skillFile)) continue;

      const raw = this.fs.readFileSync(skillFile, 'utf-8');
      const { metadata, body } = decodeBundleSkill(skillFile, raw);

      const description = typeof metadata.description === 'string' ? metadata.description : '';

      const skill: IBundleSkill = {
        name: entry.name,
        description,
        skillContent: body === raw ? body : body.trimStart(),
        ...metadata,
        skillDirectory: join(skillsDir, entry.name),
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

      const commandFile = join(commandsDir, entry.name);
      const raw = this.fs.readFileSync(commandFile, 'utf-8');
      const { metadata, body } = decodeBundleSkill(commandFile, raw);

      const name =
        typeof metadata.name === 'string' ? metadata.name : entry.name.replace(/\.md$/, '');
      const description = typeof metadata.description === 'string' ? metadata.description : '';

      commands.push({
        ...metadata,
        name: `${pluginName}:${name}`,
        description,
        skillContent: body === raw ? body : body.trimStart(),
        skillDirectory: commandsDir,
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
