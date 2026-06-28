/**
 * Command-system contracts consumed by transports.
 *
 * SSOT for the command API surface shared between the assembly layer (agent-framework)
 * and transport adapters (agent-transport). Runtime command implementations live in
 * agent-framework and import these declarations.
 */

import type { TCapabilitySafety } from './capability-contracts.js';
import type { TSessionEndReason, TUniversalValue } from '@robota-sdk/agent-core';

/** A command entry */
export interface ICommand {
  /** Command name without slash (e.g., "mode") — used for invocation */
  name: string;
  /** User-friendly display label (e.g., "Interaction Mode"). Falls back to `name` if not set. */
  displayName?: string;
  /** Short description shown in autocomplete */
  description: string;
  /** Optional usage example shown in /help output (e.g., "/compact Summarize the context"). */
  example?: string;
  /** Source identifier (e.g., "builtin", "skill") */
  source: string;
  /** Subcommands for hierarchical menus */
  subcommands?: ICommand[];
  /** Execute the command. Args is everything after the command name. */
  execute?: (args: string) => void | Promise<void>;
  /** Full SKILL.md content (only for skill commands) */
  skillContent?: string;
  /** Hint for the expected argument (Claude Code frontmatter) */
  argumentHint?: string;
  /** When true, models cannot invoke this skill autonomously */
  disableModelInvocation?: boolean;
  /** When true, models may invoke this command through the SDK-projected command tool */
  modelInvocable?: boolean;
  /** When false, users cannot invoke this skill directly */
  userInvocable?: boolean;
  /** Safety category for model-visible capability descriptors */
  safety?: TCapabilitySafety;
  /** List of tools this skill is allowed to use */
  allowedTools?: string[];
  /** Preferred model for executing this skill */
  model?: string;
  /** Effort level hint for the skill */
  effort?: string;
  /** Context scope for the skill (e.g., "project") */
  context?: string;
  /** Agent identity to use when executing this skill */
  agent?: string;
  /** Plugin installation directory (plugin skills/commands only) */
  pluginDir?: string;
}

/** A source that provides commands */
export interface ICommandSource {
  name: string;
  getCommands(): ICommand[];
}

/** Status-line command settings persisted in the settings document. */
export interface IStatusLineCommandSettings {
  enabled: boolean;
  gitBranch: boolean;
}

export type TStatusLineCommandSettingsPatch = Partial<IStatusLineCommandSettings> &
  Record<string, TUniversalValue>;

/** Typed host effects requested by a command execution. */
export type TCommandEffect =
  | { type: 'provider-hot-swap-requested'; profileName: string }
  | { type: 'language-change-requested'; language: string }
  | { type: 'settings-reset-requested' }
  | { type: 'session-exit-requested'; reason?: TSessionEndReason; message?: string }
  | { type: 'session-restart-requested'; reason: TSessionEndReason; message: string }
  | { type: 'plugin-tui-requested' }
  | { type: 'plugin-registry-reload-requested' }
  | { type: 'settings-tui-requested' }
  | { type: 'session-picker-requested' }
  | { type: 'session-renamed'; name: string }
  | { type: 'conversation-history-cleared' }
  | { type: 'session-execution-started' }
  | { type: 'statusline-settings-patch'; patch: TStatusLineCommandSettingsPatch }
  | { type: 'agent-switcher-requested' };

export type TCommandResultDataValue =
  | TUniversalValue
  | Record<string, unknown>
  | readonly Record<string, unknown>[];

/** Result of a system command execution. */
export interface ICommandResult {
  /** Human-readable output message */
  message: string;
  /** Command completed successfully */
  success: boolean;
  /** Additional structured data (command-specific diagnostics only) */
  data?: Record<string, unknown>;
  /** Typed host effects requested by the command */
  effects?: readonly TCommandEffect[];
}

/** Minimal command projection surfaced to host UIs and autocomplete. */
export interface ICommandListEntry {
  name: string;
  /** User-friendly display label. Falls back to `name` if not set. */
  displayName?: string;
  description: string;
  /** Optional usage example shown in /help output (e.g., "/compact Summarize the context"). */
  example?: string;
}

export type TPluginInstallScope = 'user' | 'project';

export interface ICommandInstalledPlugin {
  name: string;
  description: string;
  enabled: boolean;
}

export interface ICommandAvailablePlugin {
  name: string;
  description: string;
  installed: boolean;
}

export interface ICommandMarketplaceSource {
  name: string;
  type: string;
}

export interface ICommandPluginReloadResult {
  loadedPluginCount: number;
}

export interface ICommandPluginAdapter {
  listInstalled(): Promise<readonly ICommandInstalledPlugin[]>;
  listAvailablePlugins(marketplace: string): Promise<readonly ICommandAvailablePlugin[]>;
  install(pluginId: string, scope?: TPluginInstallScope): Promise<void>;
  uninstall(pluginId: string): Promise<void>;
  enable(pluginId: string): Promise<void>;
  disable(pluginId: string): Promise<void>;
  marketplaceAdd(source: string): Promise<string>;
  marketplaceRemove(name: string): Promise<void>;
  marketplaceUpdate(name: string): Promise<void>;
  marketplaceList(): Promise<readonly ICommandMarketplaceSource[]>;
  reloadPlugins(): Promise<ICommandPluginReloadResult>;
}
