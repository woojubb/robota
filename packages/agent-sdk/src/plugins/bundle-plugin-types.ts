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

/** Map of plugin identifiers to enabled/disabled state. */
export type TEnabledPlugins = Record<string, boolean>;
