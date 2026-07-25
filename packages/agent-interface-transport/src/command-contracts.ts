/**
 * Command-system contracts consumed by transports.
 *
 * SSOT for the command API surface shared between the assembly layer (agent-framework)
 * and transport adapters (agent-transport). Runtime command implementations live in
 * agent-framework and import these declarations.
 */

import type { TCapabilitySafety } from './capability-contracts.js';
import type { TSessionEndReason, TUniversalValue } from '@robota-sdk/agent-core';

/**
 * Origin of a command invocation. `'user'` = the local operator; `'model'` = a model-invoked command;
 * `'remote'` = a command arriving over a transport (WebSocket / WebRTC) from an untrusted remote peer.
 * SSOT lives here (the transport-facing `IInteractiveSession.executeCommand` carries it); `agent-framework`
 * re-exports it. A transport-origin command runs as a local one by default; an optional policy may restrict (REMOTE-006).
 */
export type TCommandInvocationSource = 'user' | 'model' | 'remote';

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

/**
 * Result of resolving a skill command to an inject-mode prompt (ARCH-PROVIDER-005). The SSOT `{prompt?, mode}`
 * contract — consumers derive their own internal shapes from this rather than duplicating it. `prompt` is
 * absent when the skill did not resolve to an inject prompt (the consumer surfaces that as an error).
 */
export interface ISkillResolutionResult {
  /** Resolution mode used (e.g. `'inject'`). */
  mode: string;
  /** Inject-mode prompt to send as a user message (absent if not resolved to an inject prompt). */
  prompt?: string;
}

/**
 * Owned execution port for skill discovery + resolution (ARCH-PROVIDER-005 / ARL-11 skill-half). A DAG skill
 * node (or any consumer) depends on THIS contract, not on the concrete `agent-framework` implementation, which
 * is injected at the composition root. Discovery returns the available skill {@link ICommand}s; `resolveSkill`
 * resolves an inject-mode skill to its prompt (fork-context skills are rejected by the consumer before calling).
 */
export interface ISkillExecutionPort {
  /** Discover the available skill commands for a working directory. */
  loadCommands(cwd: string, home?: string): ICommand[];
  /** Resolve a (non-fork) skill command to its inject-mode prompt. */
  resolveSkill(
    skill: ICommand,
    args: string,
    opts?: { sessionId?: string },
  ): Promise<ISkillResolutionResult>;
}

/** Status-line command settings persisted in the settings document. */
export interface IStatusLineCommandSettings {
  enabled: boolean;
  gitBranch: boolean;
}

export type TStatusLineCommandSettingsPatch = Partial<IStatusLineCommandSettings> &
  Record<string, TUniversalValue>;

/**
 * CMD-004 Phase 2: host-executed command ACTIONS — semantic operations the SESSION layer (the host)
 * executes via `ICommandHostAdapters` or directly on the session, BEFORE the command result is
 * returned. They execute with zero surfaces attached (headless parity — the LSP
 * `workspace/executeCommand` model); surfaces observe the outcome via session events / the result,
 * never by executing the semantics themselves.
 */
export type TCommandHostAction =
  | { type: 'provider-hot-swap'; profileName: string }
  | { type: 'language-change'; language: string }
  | { type: 'settings-reset' }
  | { type: 'session-exit'; reason?: TSessionEndReason; message?: string }
  | { type: 'session-restart'; reason: TSessionEndReason; message: string }
  | { type: 'session-rename'; name: string }
  | { type: 'statusline-settings-patch'; patch: TStatusLineCommandSettingsPatch }
  | { type: 'remote-control-enable' }
  | { type: 'remote-control-stop' };

/**
 * CMD-004 Phase 2: surface-rendered UI INTENTS — presentation requests (full-screen navigation)
 * rendered by the surface that issued the command (requester-routed via
 * `IUiIntentEvent.requesterDriverId`), fire-and-forget. Names are UI-neutral (LSP `window/show*`
 * style — never a UI-technology token); a surface that cannot render an intent reports an explicit
 * "not available on this surface" notice, never a silent drop.
 */
export type TCommandUiIntent =
  | { type: 'show-plugin-manager' }
  | { type: 'show-settings' }
  | { type: 'show-session-picker' }
  | { type: 'show-agent-switcher' };

export type TCommandResultDataValue =
  TUniversalValue | Record<string, unknown> | readonly Record<string, unknown>[];

/** Result of a system command execution. */
export interface ICommandResult {
  /** Human-readable output message */
  message: string;
  /** Command completed successfully */
  success: boolean;
  /** Additional structured data (command-specific diagnostics only) */
  data?: Record<string, unknown>;
  /** CMD-004 Phase 2: host-executed actions — applied by the session layer before the result returns. */
  hostActions?: readonly TCommandHostAction[];
  /** CMD-004 Phase 2: UI intents — emitted as `ui_intent` session events routed to the requesting surface. */
  uiIntents?: readonly TCommandUiIntent[];
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
