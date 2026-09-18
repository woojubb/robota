/**
 * Types for the BundlePlugin system.
 *
 * A BundlePlugin is a directory-based plugin package that bundles
 * skills, hooks, agents, and MCP server configurations.
 */

/** Feature flags indicating what a bundle plugin provides. */
export interface IBundlePluginFeatures {
  commands?: boolean;
  agents?: boolean;
  skills?: boolean;
  hooks?: boolean;
  mcp?: boolean;
}

/** Manifest read from `.claude-plugin/plugin.json`. */
export interface IBundlePluginManifest {
  name: string;
  version: string;
  description: string;
  features: IBundlePluginFeatures;
}

/** A skill loaded from a bundle plugin's `skills/` directory. */
export interface IBundleSkill {
  name: string;
  description: string;
  skillContent: string;
  [key: string]: unknown;
}

/** A fully loaded bundle plugin with all its assets. */
export interface ILoadedBundlePlugin {
  manifest: IBundlePluginManifest;
  skills: IBundleSkill[];
  commands: IBundleSkill[];
  hooks: Record<string, unknown>;
  mcpConfig?: unknown;
  agents: string[];
  pluginDir: string;
}

/** Why a discovered plugin was not loaded (OBSERVABILITY-1991 inspection). */
export type TBundlePluginSkipReason =
  'manifest-unreadable' | 'manifest-invalid' | 'disabled' | 'load-failed';

/** A plugin the loader discovered but did not load, and why. */
export interface IBundlePluginSkip {
  readonly pluginId: string;
  readonly manifestPath: string;
  readonly reason: TBundlePluginSkipReason;
  /** The owner error's name and message — never file content. */
  readonly detail?: string;
}

/** A hooks.json that a loaded plugin ships but which fails the settings hooks schema. */
export interface IBundlePluginHookIssue {
  readonly pluginId: string;
  readonly hooksPath: string;
  /** Failing issue paths and codes, as the schema reports them; never values. */
  readonly issues: readonly { readonly path: string; readonly code: string }[];
}

/** One MCP server a loaded plugin declares in its `.mcp.json` — keys only, never env values. */
export interface IBundlePluginMcpServer {
  readonly pluginId: string;
  readonly mcpPath: string;
  readonly name: string;
  readonly transport: 'stdio' | 'http' | 'unknown';
  readonly command?: string;
  readonly url?: string;
  readonly envKeys: readonly string[];
}

/** A `.mcp.json` that is present but structurally unusable. */
export interface IBundlePluginMcpFault {
  readonly pluginId: string;
  readonly mcpPath: string;
  readonly reason: 'unparseable' | 'not-an-object' | 'no-servers';
}

/**
 * The loader's read-only inspection result; `loadPluginsSync()` is its `loaded` projection.
 *
 * `loaded` is the runtime shape and still carries each plugin's raw `mcpConfig`; a diagnostic renders
 * only the inspection's own fields (`skipped`, `hookIssues`, `mcpServers`, `mcpFaults`), which carry
 * names, paths, reasons and env KEY names — never values.
 */
export interface IBundlePluginInspection {
  readonly pluginsDir: string;
  readonly cacheDirPresent: boolean;
  readonly loaded: readonly ILoadedBundlePlugin[];
  readonly skipped: readonly IBundlePluginSkip[];
  readonly hookIssues: readonly IBundlePluginHookIssue[];
  readonly mcpServers: readonly IBundlePluginMcpServer[];
  readonly mcpFaults: readonly IBundlePluginMcpFault[];
}

/** Map of plugin identifiers to enabled/disabled state. */
export type TEnabledPlugins = Record<string, boolean>;
