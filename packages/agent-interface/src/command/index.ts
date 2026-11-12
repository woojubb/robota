// @robota-sdk/agent-interface/command
//
// The command contract family.
//
// LAYER 0: this subpath depends on `@robota-sdk/agent-core` and on no other subpath of
// `agent-interface`. Consumers compose it downward — `agent-interface/session` names these types, never the
// reverse.
//
// `capability-contracts` is public: agent-framework's capability layer re-exports its descriptor
// types.

// ── Capability descriptor contracts ──────────────────────────
export type {
  ICapabilityDescriptor,
  TCapabilityKind,
  TCapabilitySafety,
} from './capability-contracts.js';
// ── Command-system contracts ─────────────────────────────────
export type {
  ICommand,
  ISkillContentActivation,
  ISkillResourceDescriptor,
  ISkillResource,
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
