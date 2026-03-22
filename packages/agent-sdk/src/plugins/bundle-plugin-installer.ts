/**
 * BundlePluginInstaller — installs, uninstalls, enables, and disables bundle plugins.
 *
 * Handles cloning from git/github, copying from local directories,
 * and managing plugin state in settings.json.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Source specification for installing a plugin. */
export type IPluginSource =
  | { type: 'github'; repo: string; ref?: string }
  | { type: 'git'; url: string; ref?: string }
  | { type: 'local'; path: string }
  | { type: 'url'; url: string };

/** Exec function type for running shell commands. */
type ExecFn = (command: string, options: { timeout: number }) => void;

/** Options for constructing a BundlePluginInstaller. */
export interface IBundlePluginInstallerOptions {
  /** Directory where plugins are installed (e.g., ~/.robota/plugins). */
  pluginsDir: string;
  /** Path to the settings.json file. */
  settingsPath: string;
  /** Custom exec function for testing (replaces child_process.execSync). */
  exec?: ExecFn;
}

/** Default git clone timeout in milliseconds (60 seconds). */
const GIT_CLONE_TIMEOUT_MS = 60_000;

/** Installs, uninstalls, enables, and disables bundle plugins. */
export class BundlePluginInstaller {
  private readonly pluginsDir: string;
  private readonly settingsPath: string;
  private readonly exec: ExecFn;

  constructor(options: IBundlePluginInstallerOptions) {
    this.pluginsDir = options.pluginsDir;
    this.settingsPath = options.settingsPath;
    this.exec = options.exec ?? this.defaultExec;
  }

  /**
   * Install a plugin from a source into the plugins directory.
   * Target directory: `<pluginsDir>/<pluginName>@<marketplace>/`
   */
  async install(pluginName: string, marketplace: string, source: IPluginSource): Promise<void> {
    const targetDir = join(this.pluginsDir, `${pluginName}@${marketplace}`);

    switch (source.type) {
      case 'github':
        this.installFromGit(
          `https://github.com/${source.repo}.git`,
          source.ref,
          targetDir,
          pluginName,
        );
        break;
      case 'git':
        this.installFromGit(source.url, source.ref, targetDir, pluginName);
        break;
      case 'local':
        this.installFromLocal(source.path, targetDir);
        break;
      case 'url':
        throw new Error('URL source installation is not yet supported');
    }
  }

  /** Uninstall a plugin by removing its directory and settings entry. */
  async uninstall(pluginId: string): Promise<void> {
    const pluginDir = join(this.pluginsDir, pluginId);

    if (!existsSync(pluginDir)) {
      throw new Error(`Plugin "${pluginId}" is not installed`);
    }

    rmSync(pluginDir, { recursive: true, force: true });
    this.removeSettingsEntry(pluginId);
  }

  /** Enable a plugin by setting its enabledPlugins entry to true. */
  async enable(pluginId: string): Promise<void> {
    this.updatePluginState(pluginId, true);
  }

  /** Disable a plugin by setting its enabledPlugins entry to false. */
  async disable(pluginId: string): Promise<void> {
    this.updatePluginState(pluginId, false);
  }

  /** Clone a git repository to the target directory. */
  private installFromGit(
    repoUrl: string,
    ref: string | undefined,
    targetDir: string,
    pluginName: string,
  ): void {
    const branchArg = ref ? ` --branch ${ref}` : '';
    const command = `git clone --depth 1${branchArg} ${repoUrl} ${targetDir}`;

    try {
      this.exec(command, { timeout: GIT_CLONE_TIMEOUT_MS });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to clone plugin "${pluginName}": ${message}`);
    }
  }

  /** Copy a local directory to the target directory. */
  private installFromLocal(sourcePath: string, targetDir: string): void {
    if (!existsSync(sourcePath)) {
      throw new Error(`Local plugin source path does not exist: ${sourcePath}`);
    }

    mkdirSync(targetDir, { recursive: true });
    cpSync(sourcePath, targetDir, { recursive: true });
  }

  /** Read the current settings from disk. Creates empty settings if file is missing. */
  private readSettings(): Record<string, unknown> {
    if (!existsSync(this.settingsPath)) {
      return {};
    }

    try {
      const raw = readFileSync(this.settingsPath, 'utf-8');
      const data: unknown = JSON.parse(raw);
      if (typeof data === 'object' && data !== null) {
        return data as Record<string, unknown>;
      }
      return {};
    } catch {
      return {};
    }
  }

  /** Write settings back to disk. */
  private writeSettings(settings: Record<string, unknown>): void {
    const dir = dirname(this.settingsPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
  }

  /** Update a plugin's enabled/disabled state in settings. */
  private updatePluginState(pluginId: string, enabled: boolean): void {
    const settings = this.readSettings();
    const enabledPlugins =
      typeof settings.enabledPlugins === 'object' && settings.enabledPlugins !== null
        ? (settings.enabledPlugins as Record<string, boolean>)
        : {};

    enabledPlugins[pluginId] = enabled;
    settings.enabledPlugins = enabledPlugins;
    this.writeSettings(settings);
  }

  /** Remove a plugin entry from settings. */
  private removeSettingsEntry(pluginId: string): void {
    const settings = this.readSettings();
    if (typeof settings.enabledPlugins === 'object' && settings.enabledPlugins !== null) {
      const enabledPlugins = settings.enabledPlugins as Record<string, boolean>;
      delete enabledPlugins[pluginId];
      settings.enabledPlugins = enabledPlugins;
      this.writeSettings(settings);
    }
  }

  /** Default exec implementation using child_process. */
  private defaultExec(command: string, options: { timeout: number }): void {
    // Dynamic import to avoid bundling issues — this is only used as a fallback
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { execSync } = require('node:child_process') as typeof import('node:child_process');
    execSync(command, { timeout: options.timeout, stdio: 'pipe' });
  }
}
