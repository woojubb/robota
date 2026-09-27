/**
 * #3282 §4a: the GUI Settings screen's typed snapshot and patch shapes.
 *
 * Named here (not in `agent-transport` or `agent-framework`) so a wire carrier can carry the
 * snapshot type without depending on the command/runtime layer that builds it, and the runtime
 * layer that builds it needs no dependency on any transport. Both depend downward on this package
 * instead of on each other — the same shape `TPermissionResultValue` already uses.
 *
 * Every id a choice carries is the same id the corresponding slash command accepts as an argument
 * (a language code, an output-style id, a preset id, a permission-mode name) — never a synthetic
 * GUI-only identifier — so applying a patch and running the equivalent command are the same action.
 */

/** One selectable value in a Settings pop-up menu: a plain label and description, never a bare id. */
export interface ISettingsChoice {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

/** One configured permission rule, as `/permissions` groups it, with whether it can be removed. */
export interface ISettingsPermissionRule {
  /** Stable within one snapshot: `${scope}:${kind}:${pattern}`, opaque to the client otherwise. */
  readonly id: string;
  /** `user` | `project` | `project-local` | `managed`, matching the settings layer it came from. */
  readonly scope: string;
  /** The file the rule lives in, as a person would find it (e.g. `~/.robota/settings.json`). */
  readonly source: string;
  readonly kind: 'allow' | 'deny' | 'ask';
  readonly pattern: string;
  /** `false` for a rule this host cannot rewrite (no settings-store target for its scope). */
  readonly removable: boolean;
}

export interface ISettingsLanguageSection {
  readonly current: string;
  /** The runtime's recommended languages; the control also accepts free text ("Other…"). */
  readonly recommended: readonly ISettingsChoice[];
  /** One plain sentence: when a change actually takes effect (this session, or after a restart). */
  readonly appliesNote: string;
}

export interface ISettingsOutputStyleSection {
  readonly current: string;
  readonly choices: readonly ISettingsChoice[];
}

export interface ISettingsPresetSection {
  readonly current: string;
  readonly choices: readonly ISettingsChoice[];
  /** Preset ids that, once applied, set the permission mode to `permissionMode.skipsAllChecksMode`. */
  readonly skipsAllChecksPresetIds: readonly string[];
}

export interface ISettingsPermissionModeSection {
  readonly current: string;
  readonly choices: readonly ISettingsChoice[];
  /** The mode id that skips every permission check — the one that needs its own confirmation. */
  readonly skipsAllChecksMode: string;
}

export interface ISettingsSandboxSection {
  readonly enabled: boolean;
  readonly available: boolean;
  /** Why the sandbox cannot run here, when it cannot; absent when it can. */
  readonly unavailableReason?: string;
  /** One plain sentence describing what the switch does. */
  readonly description: string;
}

/** One configured MCP server, as the MCP Servers section shows it (#3282 §4 part b-2). */
export interface ISettingsMcpServer {
  readonly id: string;
  readonly name: string;
  /** Where it is configured, in plain words: "This project" or "All projects". */
  readonly scopeLabel: string;
  /** `disabled` mirrors the switch (rejected/revoked/not yet approved); otherwise the live connection. */
  readonly status: 'connected' | 'failed' | 'disabled';
  /** A plain reason, present only when `status` is `'failed'`. */
  readonly statusReason?: string;
  readonly toolNames: readonly string[];
  /** Whether the switch would enable it (`true`) or disable it (`false`) on the next toggle. */
  readonly enabled: boolean;
}

export interface ISettingsMcpSection {
  readonly servers: readonly ISettingsMcpServer[];
}

/** One installed plugin, as the Plugins section shows it (#3282 §4 part b-2). */
export interface ISettingsPlugin {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly enabled: boolean;
}

export interface ISettingsPluginsSection {
  readonly plugins: readonly ISettingsPlugin[];
  /**
   * Whether install/uninstall are available from THIS connection. Installing runs third-party code,
   * so both stay local-surface-only (the desktop app and the local served browser page) — false for
   * a remote device or an observer, matching the refusal `/plugin install|uninstall` itself gives.
   */
  readonly canInstall: boolean;
}

/**
 * One configured provider profile, as the "Providers & Models" section lists it (#3282 §4b): the
 * profile name, a plain provider name (never its internal `type` id), its model's label, whether it
 * is the one in use, and a plain connection state — shown only when known, e.g. "Key missing".
 */
export interface ISettingsProviderProfile {
  readonly name: string;
  readonly providerLabel: string;
  /** Absent only when the profile has no model configured yet. */
  readonly model?: { readonly id: string; readonly label: string };
  readonly current: boolean;
  /** Absent when nothing is known to be wrong — never a guess. */
  readonly connectionState?: string;
}

export interface ISettingsProvidersSection {
  readonly profiles: readonly ISettingsProviderProfile[];
}

/** A full read of every Settings section this part of #3282 §4 covers. */
export interface ISettingsSnapshot {
  readonly language: ISettingsLanguageSection;
  readonly outputStyle: ISettingsOutputStyleSection;
  readonly preset: ISettingsPresetSection;
  readonly permissionMode: ISettingsPermissionModeSection;
  readonly permissionRules: readonly ISettingsPermissionRule[];
  readonly sandbox: ISettingsSandboxSection;
  readonly mcp: ISettingsMcpSection;
  readonly plugins: ISettingsPluginsSection;
  readonly providers: ISettingsProvidersSection;
}

/**
 * A discriminated patch: exactly one field of the snapshot, by the same vocabulary its command
 * uses. `agent-transport` validates every member of this union field-by-field (it is an INBOUND
 * client message payload), so a member added here must also be added to its decoder shape map.
 */
export type TSettingsPatch =
  | { readonly field: 'language'; readonly language: string }
  | { readonly field: 'outputStyle'; readonly styleId: string }
  | { readonly field: 'preset'; readonly presetId: string }
  | { readonly field: 'permissionMode'; readonly mode: string }
  | { readonly field: 'sandbox'; readonly enabled: boolean }
  | {
      readonly field: 'removePermissionRule';
      readonly scope: string;
      readonly kind: 'allow' | 'deny' | 'ask';
      readonly pattern: string;
    }
  | { readonly field: 'mcpServerEnabled'; readonly serverId: string; readonly enabled: boolean }
  | { readonly field: 'reloadMcpServers' }
  | { readonly field: 'pluginEnabled'; readonly pluginId: string; readonly enabled: boolean }
  | { readonly field: 'reloadPlugins' }
  /** `pluginId` is `<name>@<marketplace>`, the same argument `/plugin install` takes. */
  | { readonly field: 'installPlugin'; readonly pluginId: string }
  | { readonly field: 'uninstallPlugin'; readonly pluginId: string }
  // #3282 §4b: "Use" — the same path as `/provider switch <profile>` (validate, hot-swap, persist).
  | { readonly field: 'providerProfile'; readonly profileName: string }
  // #3282 §4b: "Model" — the same path as `/model <id>`; `modelId` alone, exactly like the model
  // control's own pop-up menu, since a catalog id already names which profile offers it.
  | { readonly field: 'providerModel'; readonly modelId: string }
  // #3282 §4b: "Delete" — refused (never an interactive replacement ask) when `profileName` is the
  // profile in use; a modal write has no follow-up question to ask.
  | { readonly field: 'deleteProviderProfile'; readonly profileName: string };
