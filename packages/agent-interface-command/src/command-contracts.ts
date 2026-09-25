/**
 * Command-system contracts consumed by transports.
 *
 * SSOT for the command API surface shared between the assembly layer (agent-framework)
 * and transport adapters (agent-transport). Runtime command implementations live in
 * agent-framework and import these declarations.
 */

import type { TCapabilitySafety } from './capability-contracts.js';
import type { TModelEffort, TSessionEndReason, TUniversalValue } from '@robota-sdk/agent-core';

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
  /**
   * When true, the bare command is a complete action of its own (a default view), so choosing it
   * from a menu runs it rather than opening its subcommands. Declaring subcommands (for example to
   * narrow what the model may run) then does not change what the user's Enter does.
   */
  runsBare?: boolean;
  /** Execute the command. Args is everything after the command name. */
  execute?: (args: string) => void | Promise<void>;
  /** Full SKILL.md content (only for skill commands) */
  skillContent?: string;
  /** Hint for the expected argument (Claude Code frontmatter) */
  argumentHint?: string;
  /** When true, models cannot invoke this skill autonomously */
  disableModelInvocation?: boolean;
  /**
   * When true, models may invoke this command through the SDK-projected command tool.
   *
   * On a SUBCOMMAND entry it narrows what the model may run: once any subcommand of a
   * model-invocable command declares this flag, the model may run only the bare command and the
   * subcommands declared `true` — every other first argument, including an alias or a subcommand
   * added later without the flag, is refused. That is how a command that mixes read-only views with
   * trust, credential or permission-widening actions offers the model only the safe subset.
   */
  modelInvocable?: boolean;
  /**
   * What the model is told about this command, when it differs from the short `description` shown
   * in `/help`: what it does, when to use it, and what it returns. Absent → `description`.
   */
  modelDescription?: string;
  /** When false, users cannot invoke this skill directly */
  userInvocable?: boolean;
  /** Safety category for model-visible capability descriptors */
  safety?: TCapabilitySafety;
  /** List of tools this skill is allowed to use */
  allowedTools?: string[];
  /** Preferred model for executing this skill */
  model?: string;
  /** Effort level hint for the skill */
  effort?: TModelEffort;
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
  /** Discover commands through the authority/host sources captured by the injected port. */
  loadCommands(): ICommand[];
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
 * SCREEN-2002: the appearance a run renders with, persisted as three FLAT keys in the settings
 * document (`theme`, `syntaxHighlighting`, `reducedMotion`) rather than one nested object — the
 * shape `screenReader` and `outputStyle` already use, and the shape a user editing the file by hand
 * expects. The theme is named by ID, not by value: the settings document never holds a colour, so a
 * theme that is renamed or removed degrades to a notice instead of persisting stale colours.
 */
export interface IAppearanceSettings {
  /** A theme id the registry holds. An unknown id resolves to the default WITH a visible notice. */
  theme: string;
  /** Whether fenced code blocks are syntax-highlighted. Orthogonal to the theme. */
  syntaxHighlighting: boolean;
  /** Whether animation is suppressed. A flag or the environment can override this for one run. */
  reducedMotion: boolean;
}

export type TAppearanceSettingsPatch = Partial<IAppearanceSettings> &
  Record<string, TUniversalValue>;

/** SCREEN-2002: why `reducedMotion` is not what the settings document says, for THIS run. */
export type TReducedMotionOverride = 'flag' | 'environment' | 'screen-reader';

/** One row of the theme catalogue, as a command lists it. Carries no colour — only identity. */
export interface IThemeCatalogueEntry {
  readonly id: string;
  readonly name: string;
  readonly appearance: 'dark' | 'light';
  readonly source: 'built-in' | 'user' | 'plugin';
}

export interface IThemeAppearanceState {
  /** What is PERSISTED — what a command writes to and reports as stored. */
  readonly settings: IAppearanceSettings;
  /**
   * The pin on reduced motion for this run, when something outside the settings applied one —
   * WHICH tier and WHAT it pinned, as ONE value.
   *
   * Not two optionals. The tier alone cannot be rendered: `--reduced-motion` and
   * `--no-reduced-motion` are both overrides and they pin opposite values, so a surface holding the
   * tier and the PERSISTED value prints `reduced motion: off (pinned by flag)` on a run whose
   * motion is pinned on — a line that contradicts itself and answers "is motion reduced right now"
   * with the wrong word. Two optional fields would let a producer supply the tier alone and leave
   * every consumer to default the other half, which is exactly that bug with an extra step.
   */
  readonly reducedMotionPin?: {
    readonly tier: TReducedMotionOverride;
    /** What this run DOES, which is not always what is saved. */
    readonly reducedMotion: boolean;
  };
}

/**
 * SCREEN-2002 — the surface's theme catalogue, injected into the command layer.
 *
 * The contract lives here, in the types-only package BOTH sides already depend on, rather than in
 * the command package the surface does not depend on: the alternative is the surface re-declaring a
 * structurally-compatible copy, which type-checks at the composition root and drifts everywhere
 * else. A command knows ids and never colours — which colours a theme carries, and how they are
 * applied, belongs to whatever is rendering.
 */
export interface IThemeCataloguePort {
  listThemes(): readonly IThemeCatalogueEntry[];
  getTheme(id: string): IThemeCatalogueEntry | undefined;
  getAppearance(): IThemeAppearanceState;
}

/**
 * CMD-004 Phase 2: host-executed command ACTIONS — semantic operations the SESSION layer (the host)
 * executes via `ICommandHostAdapters` or directly on the session, BEFORE the command result is
 * returned. They execute with zero surfaces attached (headless parity — the LSP
 * `workspace/executeCommand` model); surfaces observe the outcome via session events / the result,
 * never by executing the semantics themselves.
 */
export type TCommandHostAction =
  | { type: 'provider-hot-swap'; profileName: string }
  | { type: 'output-style-change'; styleId: string }
  | { type: 'language-change'; language: string }
  | { type: 'settings-reset' }
  | { type: 'session-exit'; reason?: TSessionEndReason; message?: string }
  | { type: 'session-restart'; reason: TSessionEndReason; message: string }
  | { type: 'session-rename'; name: string }
  /** Move the session to another working directory (`/cd`); `path` is as the user typed it. */
  | { type: 'workspace-move'; path: string }
  | { type: 'statusline-settings-patch'; patch: TStatusLineCommandSettingsPatch }
  | { type: 'appearance-settings-patch'; patch: TAppearanceSettingsPatch }
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
  | { type: 'show-agent-switcher' }
  | { type: 'show-theme-picker' };

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
  /**
   * SEC-008: whether a MODEL may invoke this command, carried through instead of dropped.
   *
   * The list used to stop at name/description, so every consumer received a flat catalogue with no
   * way to tell an operator-only command from a model-callable one. The MCP adapter read that list
   * and registered all of it as callable tools, which turned commands explicitly marked
   * `modelInvocable: false` — `plugin` installs and enables code — into things a remote peer's model
   * could call.
   *
   * REQUIRED rather than optional, because an optional flag would let a consumer read `undefined`
   * for two unrelated situations: "this command may not be model-invoked" and "the producer of this
   * list does not say". Those need different handling and the first must not be reached by accident.
   */
  modelInvocable: boolean;
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
