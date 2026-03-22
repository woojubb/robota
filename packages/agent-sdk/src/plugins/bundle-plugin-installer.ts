/**
 * BundlePluginInstaller — installs, uninstalls, enables, and disables bundle plugins.
 *
 * Handles cloning from git/github, copying from local directories,
 * and managing plugin state via PluginSettingsStore.
 */

import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { PluginSettingsStore } from './plugin-settings-store.js';

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
  /** Shared settings store for persistence. */
  settingsStore: PluginSettingsStore;
  /** Custom exec function for testing (replaces child_process.execSync). */
  exec?: ExecFn;
}

/** Default git clone timeout in milliseconds (60 seconds). */
const GIT_CLONE_TIMEOUT_MS = 60_000;

/** Installs, uninstalls, enables, and disables bundle plugins. */
export class BundlePluginInstaller {
  private readonly pluginsDir: string;
  private readonly settingsStore: PluginSettingsStore;
  private readonly exec: ExecFn;

  constructor(options: IBundlePluginInstallerOptions) {
    this.pluginsDir = options.pluginsDir;
    this.settingsStore = options.settingsStore;
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
    this.settingsStore.removePluginEntry(pluginId);
  }

  /** Enable a plugin by setting its enabledPlugins entry to true. */
  async enable(pluginId: string): Promise<void> {
    this.settingsStore.setPluginEnabled(pluginId, true);
  }

  /** Disable a plugin by setting its enabledPlugins entry to false. */
  async disable(pluginId: string): Promise<void> {
    this.settingsStore.setPluginEnabled(pluginId, false);
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

  /** Default exec implementation using child_process. */
  private defaultExec(command: string, options: { timeout: number }): void {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { execSync } = require('node:child_process') as typeof import('node:child_process');
    execSync(command, { timeout: options.timeout, stdio: 'pipe' });
  }
}
