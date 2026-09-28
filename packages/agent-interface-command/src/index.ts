// @robota-sdk/agent-interface-command
//
// The command contract family, moved out of `agent-interface-transport` by ARCH-104 (issue #2108).
//
// LAYER 0: this package depends on `@robota-sdk/agent-core` and on no peer `agent-interface-*`
// package. Consumers compose it downward — `agent-interface-session` names these types, never the
// reverse.
//
// `capability-contracts` moves WITH its export and stays public: agent-framework's capability layer
// re-exports its descriptor types.

// ── Capability descriptor contracts ──────────────────────────
export type {
  ICapabilityDescriptor,
  TCapabilityKind,
  TCapabilitySafety,
} from './capability-contracts.js';
// ── Command-system contracts ─────────────────────────────────
export type {
  ICommand,
  ICommandSource,
  ISkillExecutionPort,
  ISkillResolutionResult,
  ICommandResult,
  TCommandResultDataValue,
  TCommandInvocationSource,
  TCommandSurfaceLocality,
  TCommandRunner,
  TCommandSurface,
  ICommandListEntry,
  ICommandSubcommandEntry,
  ICommandSkillListEntry,
  TCommandHostAction,
  TCommandUiIntent,
  ICommandPluginAdapter,
  ICommandInstalledPlugin,
  ICommandAvailablePlugin,
  ICommandMarketplaceSource,
  ICommandPluginReloadResult,
  TPluginInstallScope,
  IStatusLineCommandSettings,
  TStatusLineCommandSettingsPatch,
  IAppearanceSettings,
  TAppearanceSettingsPatch,
  IThemeAppearanceState,
  IThemeCatalogueEntry,
  IThemeCataloguePort,
  TReducedMotionOverride,
} from './command-contracts.js';
