export * from './agent/index.js';
export * from './default/index.js';
export * from './background/index.js';
export * from './goal/index.js';
// HANDOFF-001 (issue #1864). Named rather than `export *`: the star form is frozen pre-existing
// debt in this barrel, and `sdk-public-surface` lets it shrink but never grow.
export {
  HandoffCommandSource,
  createHandoffCommandEntry,
  createHandoffCommandModule,
  executeHandoffCommand,
} from './handoff/index.js';
export * from './plan/index.js';
export * from './compact/index.js';
export * from './context/index.js';
export * from './editor/index.js';
// OBSERVABILITY-1991: named rather than `export *` — the star form is frozen debt in this barrel.
export {
  STORAGE_REPAIR_ID,
  doctorRepairAllowlist,
  DoctorCommandSource,
  applyDoctorRepair,
  buildDoctorReport,
  collectSettingsSecrets,
  createDoctorCommandEntry,
  createDoctorCommandModule,
  createNodeDoctorDeps,
  isDoctorRepairId,
  planDoctorRepair,
  redactDiagnosticText,
  renderDoctorReport,
  resolveCommandOnPath,
  runDoctor,
  type IDoctorCheck,
  type IDoctorDeps,
  type IDoctorEndpointProbeResult,
  type IDoctorInputs,
  type IDoctorPathFacts,
  type IDoctorRepairPlan,
  type IDoctorReport,
  type TDoctorCheckStatus,
  type TDoctorNotProbed,
  type TDoctorRepairOutcome,
  type TDoctorRepairPlanResult,
} from './doctor/index.js';
export {
  EffortCommandSource,
  createEffortCommandEntry,
  createEffortCommandModule,
  executeEffortCommand,
} from './effort/index.js';
export * from './exit/index.js';
export * from './help/index.js';
export {
  createKeybindingsCommandEntry,
  createKeybindingsCommandModule,
  KeybindingsCommandSource,
  type IKeybindingsFilePort,
} from './keybindings/index.js';
export * from './language/index.js';
export * from './memory/index.js';
export {
  createMCPActivationCommandEntry,
  createMCPActivationCommandModule,
  MCPActivationCommandSource,
} from './mcp-activation/mcp-activation-command-module.js';
export { executeMCPActivationCommand } from './mcp-activation/mcp-activation-command.js';
export * from './mode/index.js';
export {
  OutputStyleCommandSource,
  createOutputStyleCommandEntry,
  createOutputStyleCommandModule,
  executeOutputStyleCommand,
} from './output-style/index.js';
export * from './permissions/index.js';
export * from './plugin/index.js';
export * from './preset/index.js';
export * from './shell/index.js';
export * from './provider/index.js';
export * from './remote-control/index.js';
export * from './reset/index.js';
export * from './rewind/index.js';
export * from './schedule/index.js';
export * from './session/index.js';
export * from './settings/index.js';
export * from './skills/index.js';
export * from './statusline/index.js';
export * from './user-local/index.js';
export { createDefaultPluginCommandAdapter } from './plugins/default-plugin-command-adapter.js';
export {
  pluginScopeDirs,
  reloadPluginCommandSource,
} from './plugins/default-plugin-command-source-loader.js';
