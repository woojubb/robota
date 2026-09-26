// @robota-sdk/agent-interface-command
//
// The command contract family, moved out of `agent-interface-transport` by ARCH-104 (issue #2108).
//
// LAYER 0: this package depends on `@robota-sdk/agent-core` and on no peer `agent-interface-*`
// package. Consumers compose it downward — `agent-interface-session` names these types, never the
// reverse.
//
// `capability-contracts` moves WITH its export. It has no consumer outside this package —
// `command-contracts` is its only importer — and the owner ruled on issue #2177 that it stays public.
// A zero-consumer count establishes a question about a surface; it does not answer it.

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
  ICommandListEntry,
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
