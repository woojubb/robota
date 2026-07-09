#!/usr/bin/env node

/**
 * Bidirectional check that a package SPEC's Public API table and the package's actual
 * runtime public surface stay in sync. One guard owns both edges of "table ⟷ surface":
 *
 * FORWARD (`spec-phantom-export`) — Guard G3-lite (architecture audit 2026-06-19,
 * AF-13/AF-21 class). Every identifier the table advertises must appear somewhere in
 * `src/`; SPECs had listed phantom exports (e.g. `IPlaygroundBootState`,
 * `createModelCommandModule`) that no longer existed in source.
 *
 * Conservative by design — near-zero false positives:
 * - Only scans sections whose heading matches `Public API` (the standardized surface
 *   table). Type-ownership / dependency / build-output tables are ignored.
 * - Only checks the first back-tick token of each table row, and only when it is a
 *   bare JS identifier (`/^[A-Za-z_$][\w$]*$/`) — sub-paths (`./anthropic`), file
 *   paths, and prose are skipped.
 * - A real export's name always appears in `src/` (at its definition or barrel
 *   re-export); a phantom one appears nowhere. That asymmetry is the whole check.
 *
 * REVERSE (`spec-undocumented-export`) — INFRA-DOC-GUARD-001 (architecture audit
 * 2026-06-14, AF-02/AF-04 class). Every EFFECTIVE runtime export of the package entry
 * (`src/index.ts`, plus `browser.ts`/`node.ts` when package.json points there) must be
 * listed as a Public API table identifier. "Effective runtime export" = direct
 * `export const/function/class/enum`, plus names surfaced by re-export edges
 * (`export { A, B as C } from './x'` and `export * from './x'` resolved recursively) —
 * excluding all type-only exports (`export type`, `interface`, `export { type A }`).
 * Parsed via the TypeScript AST (not line-regex) so multi-line `export {` and nested
 * `export *` barrels resolve correctly. Derives from a published completeness contract
 * (spec-writing-standard: "the Public API table MUST list every runtime export of the
 * package entry"), so the gate enforces a rule, not an invented target.
 *
 * Intentional internal-surface exports are frozen in UNDOCUMENTED_EXPORT_ALLOWLIST
 * (frozen-baseline precedent: check-orphan-exports.mjs's ORPHAN_EXPORT_ALLOWLIST) — the
 * current live set is seeded so the scan is green today; any NEW undocumented export
 * (not in the baseline) fails.
 *
 * Exit code 0 = clean, 1 = findings.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

import { listSpecPackageDirs } from './workspace-packages.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

/**
 * Runtime exports intentionally NOT listed in a package's Public API table, keyed by
 * `"<pkgName>#<symbol>"`. Frozen baseline (see ORPHAN_EXPORT_ALLOWLIST precedent): seeded
 * with EXACTLY the exports undocumented at INFRA-DOC-GUARD-001 landing so the live scan is
 * green; any new undocumented entry export must be either documented in the SPEC table or
 * added here with a reason. Burn this down; do not grow it casually.
 */
export const UNDOCUMENTED_EXPORT_ALLOWLIST = new Set([
  // Seeded at INFRA-DOC-GUARD-001 landing — pre-existing undocumented entry exports (audit
  // 2026-06-14 drift backlog). Each is a real runtime export absent from its SPEC Public API
  // table; documenting or un-exporting them is the burndown this baseline tracks.
  '@robota-sdk/agent-cli#startCli',
  '@robota-sdk/agent-command#AgentCommandSource',
  '@robota-sdk/agent-command#BackgroundCommandSource',
  '@robota-sdk/agent-command#CLEAR_COMMAND_MESSAGE',
  '@robota-sdk/agent-command#CompactCommandSource',
  '@robota-sdk/agent-command#ContextCommandSource',
  '@robota-sdk/agent-command#EDITOR_COMMAND_DESCRIPTION',
  '@robota-sdk/agent-command#EditorCommandSource',
  '@robota-sdk/agent-command#ExitCommandSource',
  '@robota-sdk/agent-command#GOAL_COMMAND_DESCRIPTION',
  '@robota-sdk/agent-command#GoalCommandSource',
  '@robota-sdk/agent-command#HelpCommandSource',
  '@robota-sdk/agent-command#LanguageCommandSource',
  '@robota-sdk/agent-command#MemoryCommandSource',
  '@robota-sdk/agent-command#ModeCommandSource',
  '@robota-sdk/agent-command#PermissionsCommandSource',
  '@robota-sdk/agent-command#PluginManagerCommandSource',
  '@robota-sdk/agent-command#PresetCommandSource',
  '@robota-sdk/agent-command#ProviderCommandSource',
  '@robota-sdk/agent-command#RewindCommandSource',
  '@robota-sdk/agent-command#SHELL_COMMAND_DESCRIPTION',
  '@robota-sdk/agent-command#SKILLS_COMMAND_DESCRIPTION',
  '@robota-sdk/agent-command#STATUSLINE_USAGE',
  '@robota-sdk/agent-command#ScheduleCommandSource',
  '@robota-sdk/agent-command#SessionCommandSource',
  '@robota-sdk/agent-command#SettingsCommandSource',
  '@robota-sdk/agent-command#ShellCommandSource',
  '@robota-sdk/agent-command#SkillsCommandSource',
  '@robota-sdk/agent-command#StatusLineCommandSource',
  '@robota-sdk/agent-command#USER_LOCAL_COMMAND_ARGUMENT_HINT',
  '@robota-sdk/agent-command#USER_LOCAL_COMMAND_DESCRIPTION',
  '@robota-sdk/agent-command#USER_LOCAL_COMMAND_USAGE',
  '@robota-sdk/agent-command#UserLocalCommandSource',
  '@robota-sdk/agent-command#createAgentCommandEntry',
  '@robota-sdk/agent-command#createAgentCommandModule',
  '@robota-sdk/agent-command#createAgentSystemCommand',
  '@robota-sdk/agent-command#createBackgroundCommandEntry',
  '@robota-sdk/agent-command#createBackgroundCommandModule',
  '@robota-sdk/agent-command#createClearCommandEntry',
  '@robota-sdk/agent-command#createCompactCommandEntry',
  '@robota-sdk/agent-command#createCompactCommandModule',
  '@robota-sdk/agent-command#createContextCommandEntry',
  '@robota-sdk/agent-command#createContextCommandModule',
  '@robota-sdk/agent-command#createCostCommandEntry',
  '@robota-sdk/agent-command#createDefaultCommandModules',
  '@robota-sdk/agent-command#createDefaultPluginCommandAdapter',
  '@robota-sdk/agent-command#createEditorCommandEntry',
  '@robota-sdk/agent-command#createEditorCommandModule',
  '@robota-sdk/agent-command#createExitCommandEntry',
  '@robota-sdk/agent-command#createExitCommandModule',
  '@robota-sdk/agent-command#createGoalCommandEntry',
  '@robota-sdk/agent-command#createGoalCommandModule',
  '@robota-sdk/agent-command#createHelpCommandEntry',
  '@robota-sdk/agent-command#createHelpCommandModule',
  '@robota-sdk/agent-command#createLanguageCommandEntry',
  '@robota-sdk/agent-command#createLanguageCommandModule',
  '@robota-sdk/agent-command#createMemoryCommandEntry',
  '@robota-sdk/agent-command#createMemoryCommandModule',
  '@robota-sdk/agent-command#createModeCommandEntry',
  '@robota-sdk/agent-command#createModeCommandModule',
  '@robota-sdk/agent-command#createMonitorCommandEntry',
  '@robota-sdk/agent-command#createPermissionsCommandEntry',
  '@robota-sdk/agent-command#createPermissionsCommandModule',
  '@robota-sdk/agent-command#createPluginCommandEntry',
  '@robota-sdk/agent-command#createPluginCommandModule',
  '@robota-sdk/agent-command#createPresetCommandEntry',
  '@robota-sdk/agent-command#createPresetCommandModule',
  '@robota-sdk/agent-command#createProviderCommandEntry',
  '@robota-sdk/agent-command#createProviderCommandModule',
  '@robota-sdk/agent-command#createProviderSetupFlow',
  '@robota-sdk/agent-command#createReloadPluginsCommandEntry',
  '@robota-sdk/agent-command#createRenameCommandEntry',
  '@robota-sdk/agent-command#createResetCommandEntry',
  '@robota-sdk/agent-command#createResetCommandModule',
  '@robota-sdk/agent-command#createResumeCommandEntry',
  '@robota-sdk/agent-command#createRewindCommandModule',
  '@robota-sdk/agent-command#createScheduleCommandEntry',
  '@robota-sdk/agent-command#createScheduleCommandModule',
  '@robota-sdk/agent-command#createSessionCommandModule',
  '@robota-sdk/agent-command#createSettingsCommandEntry',
  '@robota-sdk/agent-command#createSettingsCommandModule',
  '@robota-sdk/agent-command#createShellCommandEntry',
  '@robota-sdk/agent-command#createShellCommandModule',
  '@robota-sdk/agent-command#createSkillsCommandEntry',
  '@robota-sdk/agent-command#createSkillsCommandModule',
  '@robota-sdk/agent-command#createStatusLineCommandEntry',
  '@robota-sdk/agent-command#createStatusLineCommandModule',
  '@robota-sdk/agent-command#createUserLocalCommandEntry',
  '@robota-sdk/agent-command#createUserLocalCommandModule',
  '@robota-sdk/agent-command#createValidateSessionCommandEntry',
  '@robota-sdk/agent-command#ensureProviderConfig',
  '@robota-sdk/agent-command#executeAgentCommand',
  '@robota-sdk/agent-command#executeBackgroundCommand',
  '@robota-sdk/agent-command#executeClearCommand',
  '@robota-sdk/agent-command#executeCompactCommand',
  '@robota-sdk/agent-command#executeContextCommand',
  '@robota-sdk/agent-command#executeCostCommand',
  '@robota-sdk/agent-command#executeEditorCommand',
  '@robota-sdk/agent-command#executeExitCommand',
  '@robota-sdk/agent-command#executeGoalCommand',
  '@robota-sdk/agent-command#executeHelpCommand',
  '@robota-sdk/agent-command#executeLanguageCommand',
  '@robota-sdk/agent-command#executeMemoryCommand',
  '@robota-sdk/agent-command#executeModeCommand',
  '@robota-sdk/agent-command#executeMonitorCommand',
  '@robota-sdk/agent-command#executePermissionsCommand',
  '@robota-sdk/agent-command#executePluginCommand',
  '@robota-sdk/agent-command#executePresetCommand',
  '@robota-sdk/agent-command#executeProviderCommand',
  '@robota-sdk/agent-command#executeReloadPluginsCommand',
  '@robota-sdk/agent-command#executeRenameCommand',
  '@robota-sdk/agent-command#executeResetCommand',
  '@robota-sdk/agent-command#executeResumeCommand',
  '@robota-sdk/agent-command#executeRewindCommand',
  '@robota-sdk/agent-command#executeScheduleCommand',
  '@robota-sdk/agent-command#executeShellCommand',
  '@robota-sdk/agent-command#executeSkillsCommand',
  '@robota-sdk/agent-command#executeStatusLineCommand',
  '@robota-sdk/agent-command#executeUserLocalCommand',
  '@robota-sdk/agent-command#executeUserLocalDirectCommand',
  '@robota-sdk/agent-command#executeValidateSessionCommand',
  '@robota-sdk/agent-command#formatProviderSetupChoiceLabel',
  '@robota-sdk/agent-command#formatProviderSetupHelpLinks',
  '@robota-sdk/agent-command#formatProviderSetupPromptLabel',
  '@robota-sdk/agent-command#formatProviderSetupSelectionPrompt',
  '@robota-sdk/agent-command#getProviderSetupStep',
  '@robota-sdk/agent-command#parseScheduleSpec',
  '@robota-sdk/agent-command#reloadPluginCommandSource',
  '@robota-sdk/agent-command#resolveEditor',
  '@robota-sdk/agent-command#resolveProviderSetupSelection',
  '@robota-sdk/agent-command#resolveShell',
  '@robota-sdk/agent-command#runProviderSetupPromptFlow',
  '@robota-sdk/agent-command#runProviderStartupSetup',
  '@robota-sdk/agent-command#spawnInherited',
  '@robota-sdk/agent-command#submitProviderSetupValue',
  '@robota-sdk/agent-command#validateProviderSetupValue',
  '@robota-sdk/agent-core#AGENT_EVENTS',
  '@robota-sdk/agent-core#AGENT_EVENT_PREFIX',
  '@robota-sdk/agent-core#AbstractAIProvider',
  '@robota-sdk/agent-core#AbstractAgent',
  '@robota-sdk/agent-core#AbstractEventService',
  '@robota-sdk/agent-core#AbstractExecutor',
  '@robota-sdk/agent-core#AbstractManager',
  '@robota-sdk/agent-core#AbstractPlugin',
  '@robota-sdk/agent-core#AbstractTool',
  '@robota-sdk/agent-core#AgentFactory',
  '@robota-sdk/agent-core#AgentTemplates',
  '@robota-sdk/agent-core#AuthenticationError',
  '@robota-sdk/agent-core#CLAUDE_MODELS',
  '@robota-sdk/agent-core#CONFIRM_NO',
  '@robota-sdk/agent-core#CONFIRM_YES',
  '@robota-sdk/agent-core#CONTEXT_ESTIMATE_CHARS_PER_TOKEN',
  '@robota-sdk/agent-core#CacheIntegrityError',
  '@robota-sdk/agent-core#CircuitBreakerOpenError',
  '@robota-sdk/agent-core#ConfigurationError',
  '@robota-sdk/agent-core#ConsoleLogger',
  '@robota-sdk/agent-core#ConversationHistory',
  '@robota-sdk/agent-core#ConversationStore',
  '@robota-sdk/agent-core#DEFAULT_ABSTRACT_EVENT_SERVICE',
  '@robota-sdk/agent-core#DEFAULT_CONTEXT_WINDOW',
  '@robota-sdk/agent-core#DEFAULT_MAX_OUTPUT',
  '@robota-sdk/agent-core#DefaultEventService',
  '@robota-sdk/agent-core#ENV_REFERENCE_PREFIX',
  '@robota-sdk/agent-core#EVENT_EMITTER_EVENTS',
  '@robota-sdk/agent-core#EXECUTION_EVENTS',
  '@robota-sdk/agent-core#EXECUTION_EVENT_PREFIX',
  '@robota-sdk/agent-core#ErrorUtils',
  '@robota-sdk/agent-core#EventEmitterPlugin',
  '@robota-sdk/agent-core#EventHistoryModule',
  '@robota-sdk/agent-core#ExecutionProxy',
  '@robota-sdk/agent-core#FunctionTool',
  '@robota-sdk/agent-core#InMemoryEventEmitterMetrics',
  '@robota-sdk/agent-core#LocalExecutor',
  '@robota-sdk/agent-core#MODEL_PRICES',
  '@robota-sdk/agent-core#MODE_POLICY',
  '@robota-sdk/agent-core#MessageConverter',
  '@robota-sdk/agent-core#ModelNotAvailableError',
  '@robota-sdk/agent-core#NetworkError',
  '@robota-sdk/agent-core#ObservableEventService',
  '@robota-sdk/agent-core#PluginCategory',
  '@robota-sdk/agent-core#PluginError',
  '@robota-sdk/agent-core#PluginPriority',
  '@robota-sdk/agent-core#ProviderError',
  '@robota-sdk/agent-core#RateLimitError',
  '@robota-sdk/agent-core#Robota',
  '@robota-sdk/agent-core#RobotaError',
  '@robota-sdk/agent-core#SilentLogger',
  '@robota-sdk/agent-core#StorageError',
  '@robota-sdk/agent-core#StructuredEventService',
  '@robota-sdk/agent-core#StructuredOutputError',
  '@robota-sdk/agent-core#TASK_EVENTS',
  '@robota-sdk/agent-core#TASK_EVENT_PREFIX',
  '@robota-sdk/agent-core#TOOL_EVENTS',
  '@robota-sdk/agent-core#TOOL_EVENT_PREFIX',
  '@robota-sdk/agent-core#TRUST_TO_MODE',
  '@robota-sdk/agent-core#ToolExecutionError',
  '@robota-sdk/agent-core#ToolRegistry',
  '@robota-sdk/agent-core#TypeUtils',
  '@robota-sdk/agent-core#UNKNOWN_TOOL_FALLBACK',
  '@robota-sdk/agent-core#USER_EVENTS',
  '@robota-sdk/agent-core#USER_EVENT_PREFIX',
  '@robota-sdk/agent-core#ValidationError',
  '@robota-sdk/agent-core#Validator',
  '@robota-sdk/agent-core#assertProviderNativeWebToolsAvailable',
  '@robota-sdk/agent-core#bindEventServiceOwner',
  '@robota-sdk/agent-core#bindWithOwnerPath',
  '@robota-sdk/agent-core#calculateModelCost',
  '@robota-sdk/agent-core#chatEntryToMessage',
  '@robota-sdk/agent-core#collectAssistantUsageMetadata',
  '@robota-sdk/agent-core#composeEventName',
  '@robota-sdk/agent-core#confirmAction',
  '@robota-sdk/agent-core#createAssistantMessage',
  '@robota-sdk/agent-core#createDefaultProviderCapabilities',
  '@robota-sdk/agent-core#createExecutionProxy',
  '@robota-sdk/agent-core#createLogger',
  '@robota-sdk/agent-core#createRecordingProvider',
  '@robota-sdk/agent-core#createReplayProvider',
  '@robota-sdk/agent-core#createScriptedProvider',
  '@robota-sdk/agent-core#createSystemMessage',
  '@robota-sdk/agent-core#createToolMessage',
  '@robota-sdk/agent-core#createUserMessage',
  '@robota-sdk/agent-core#estimateBlendedCostPer1000',
  '@robota-sdk/agent-core#estimateContextTokensFromMessages',
  '@robota-sdk/agent-core#estimateSerializedContextTokens',
  '@robota-sdk/agent-core#evaluatePermission',
  '@robota-sdk/agent-core#extractEnumValues',
  '@robota-sdk/agent-core#findProviderDefinition',
  '@robota-sdk/agent-core#formatEnvReference',
  '@robota-sdk/agent-core#formatSupportedProviderTypes',
  '@robota-sdk/agent-core#formatTokenCount',
  '@robota-sdk/agent-core#getGlobalLogLevel',
  '@robota-sdk/agent-core#getMessagesForAPI',
  '@robota-sdk/agent-core#getModelContextWindow',
  '@robota-sdk/agent-core#getModelMaxOutput',
  '@robota-sdk/agent-core#getModelName',
  '@robota-sdk/agent-core#getProviderCapabilities',
  '@robota-sdk/agent-core#getProviderCredentialRequirement',
  '@robota-sdk/agent-core#getSchemaTypeName',
  '@robota-sdk/agent-core#getToolEstimatedDuration',
  '@robota-sdk/agent-core#getToolExecutionSteps',
  '@robota-sdk/agent-core#hasUsableSecretReference',
  '@robota-sdk/agent-core#hasValidationConstraints',
  '@robota-sdk/agent-core#isAssistantMessage',
  '@robota-sdk/agent-core#isChatEntry',
  '@robota-sdk/agent-core#isConfirmed',
  '@robota-sdk/agent-core#isDefaultEventService',
  '@robota-sdk/agent-core#isEnvReference',
  '@robota-sdk/agent-core#isImageGenerationProvider',
  '@robota-sdk/agent-core#isProgressReportingTool',
  '@robota-sdk/agent-core#isSystemMessage',
  '@robota-sdk/agent-core#isToolMessage',
  '@robota-sdk/agent-core#isUserMessage',
  '@robota-sdk/agent-core#isVideoGenerationProvider',
  '@robota-sdk/agent-core#logger',
  '@robota-sdk/agent-core#lookupModelPrice',
  '@robota-sdk/agent-core#messageToHistoryEntry',
  '@robota-sdk/agent-core#multiSelectAction',
  '@robota-sdk/agent-core#normalizeStructuredOutput',
  '@robota-sdk/agent-core#parseStructuredResponseText',
  '@robota-sdk/agent-core#readTokenUsageFromMessage',
  '@robota-sdk/agent-core#readTokenUsageFromMetadata',
  '@robota-sdk/agent-core#resolveEnvReference',
  '@robota-sdk/agent-core#resolvePlatformShell',
  '@robota-sdk/agent-core#runHooks',
  '@robota-sdk/agent-core#selectAction',
  '@robota-sdk/agent-core#setGlobalLogLevel',
  '@robota-sdk/agent-core#setToolProgressCallback',
  '@robota-sdk/agent-core#startPeriodicTask',
  '@robota-sdk/agent-core#stopPeriodicTask',
  '@robota-sdk/agent-core#sumHistoryUsage',
  '@robota-sdk/agent-core#textAction',
  '@robota-sdk/agent-core#validateAgainstJsonSchema',
  '@robota-sdk/agent-core#validateAgentConfig',
  '@robota-sdk/agent-core#validateApiKey',
  '@robota-sdk/agent-core#validateModelName',
  '@robota-sdk/agent-core#validateProviderName',
  '@robota-sdk/agent-core#validateUserInput',
  '@robota-sdk/agent-core#withEventEmission',
  '@robota-sdk/agent-core#zodToJsonSchema',
  '@robota-sdk/agent-executor#BackgroundTaskError',
  '@robota-sdk/agent-executor#BackgroundTaskManager',
  '@robota-sdk/agent-executor#DEFAULT_BACKGROUND_TASK_LOG_PAGE_SIZE',
  '@robota-sdk/agent-executor#SubagentManager',
  '@robota-sdk/agent-executor#WorktreeSubagentRunner',
  '@robota-sdk/agent-executor#appendPrefixedLogLines',
  '@robota-sdk/agent-executor#createBackgroundTaskLogPage',
  '@robota-sdk/agent-executor#createDefaultBackgroundTaskRunners',
  '@robota-sdk/agent-executor#createLimitedOutputCapture',
  '@robota-sdk/agent-executor#createManagedShellProcessRunner',
  '@robota-sdk/agent-executor#createProviderFromConfig',
  '@robota-sdk/agent-executor#createProviderFromProfile',
  '@robota-sdk/agent-executor#createScheduledTaskRunner',
  '@robota-sdk/agent-executor#createWorktreeSubagentRunner',
  '@robota-sdk/agent-executor#getBackgroundTaskTransitions',
  '@robota-sdk/agent-executor#isTerminalBackgroundTaskStatus',
  '@robota-sdk/agent-executor#normalizeProviderConfig',
  '@robota-sdk/agent-executor#resolveProfileApiKey',
  '@robota-sdk/agent-executor#transitionBackgroundTaskStatus',
  '@robota-sdk/agent-framework#AUTO_COMPACT_THRESHOLD_SETTINGS_KEY',
  '@robota-sdk/agent-framework#BACKGROUND_COMMAND_DESCRIPTION',
  '@robota-sdk/agent-framework#BACKGROUND_COMMAND_USAGE',
  '@robota-sdk/agent-framework#CLEAR_COMMAND_DESCRIPTION',
  '@robota-sdk/agent-framework#CLI_UPDATE_CACHE_TTL_MS',
  '@robota-sdk/agent-framework#CLI_UPDATE_PACKAGE_NAME',
  '@robota-sdk/agent-framework#CLI_UPDATE_REGISTRY_URL',
  '@robota-sdk/agent-framework#CLI_UPDATE_TIMEOUT_MS',
  '@robota-sdk/agent-framework#COST_COMMAND_DESCRIPTION',
  '@robota-sdk/agent-framework#DEFAULT_AUTO_COMPACT_THRESHOLD',
  '@robota-sdk/agent-framework#DEFAULT_GOAL_MAX_ITERATIONS',
  '@robota-sdk/agent-framework#DEFAULT_GOAL_NO_PROGRESS_LIMIT',
  '@robota-sdk/agent-framework#DEFAULT_STATUS_LINE_COMMAND_SETTINGS',
  '@robota-sdk/agent-framework#EXECUTION_ORIGIN_METADATA_KEYS',
  '@robota-sdk/agent-framework#EXIT_COMMAND_DESCRIPTION',
  '@robota-sdk/agent-framework#GOAL_SIGNAL_TOOL_NAME',
  '@robota-sdk/agent-framework#GoalController',
  '@robota-sdk/agent-framework#HELP_COMMAND_DESCRIPTION',
  '@robota-sdk/agent-framework#LANGUAGE_COMMAND_ARGUMENT_HINT',
  '@robota-sdk/agent-framework#LANGUAGE_COMMAND_DESCRIPTION',
  '@robota-sdk/agent-framework#MEMORY_COMMAND_ARGUMENT_HINT',
  '@robota-sdk/agent-framework#MEMORY_COMMAND_DESCRIPTION',
  '@robota-sdk/agent-framework#MEMORY_COMMAND_USAGE',
  '@robota-sdk/agent-framework#MEMORY_INDEX_MAX_BYTES',
  '@robota-sdk/agent-framework#MEMORY_INDEX_MAX_LINES',
  '@robota-sdk/agent-framework#MODEL_COMMAND_TOOL_PREFIX',
  '@robota-sdk/agent-framework#PERMISSIONS_COMMAND_DESCRIPTION',
  '@robota-sdk/agent-framework#PERMISSION_MODE_ARGUMENT_HINT',
  '@robota-sdk/agent-framework#PERMISSION_MODE_COMMAND_DESCRIPTION',
  '@robota-sdk/agent-framework#PLUGIN_COMMAND_ARGUMENT_HINT',
  '@robota-sdk/agent-framework#PLUGIN_COMMAND_DESCRIPTION',
  '@robota-sdk/agent-framework#PROVIDER_SAFE_TOOL_NAME_PATTERN',
  '@robota-sdk/agent-framework#ProviderConfigError',
  '@robota-sdk/agent-framework#RECOMMENDED_RESPONSE_LANGUAGES',
  '@robota-sdk/agent-framework#RELOAD_PLUGINS_COMMAND_DESCRIPTION',
  '@robota-sdk/agent-framework#RENAME_COMMAND_DESCRIPTION',
  '@robota-sdk/agent-framework#RENAME_COMMAND_USAGE',
  '@robota-sdk/agent-framework#RESUME_COMMAND_DESCRIPTION',
  '@robota-sdk/agent-framework#REWIND_COMMAND_ARGUMENT_HINT',
  '@robota-sdk/agent-framework#REWIND_COMMAND_DESCRIPTION',
  '@robota-sdk/agent-framework#STATUSLINE_COMMAND_ARGUMENT_HINT',
  '@robota-sdk/agent-framework#STATUSLINE_COMMAND_DESCRIPTION',
  '@robota-sdk/agent-framework#ScriptedSessionHarness',
  '@robota-sdk/agent-framework#SettingsParseError',
  '@robota-sdk/agent-framework#USER_LOCAL_MEMORY_CATEGORIES',
  '@robota-sdk/agent-framework#USER_LOCAL_STORAGE_CATEGORIES',
  '@robota-sdk/agent-framework#USER_LOCAL_STORAGE_CATEGORY_DEFINITIONS',
  '@robota-sdk/agent-framework#VALIDATE_SESSION_COMMAND_DESCRIPTION',
  '@robota-sdk/agent-framework#VALID_PERMISSION_MODES',
  '@robota-sdk/agent-framework#addCommandContextReference',
  '@robota-sdk/agent-framework#applyActiveModelChange',
  '@robota-sdk/agent-framework#applyProviderConfiguration',
  '@robota-sdk/agent-framework#applyProviderSwitch',
  '@robota-sdk/agent-framework#applyStatusLineSettings',
  '@robota-sdk/agent-framework#buildBackgroundCommandSubcommands',
  '@robota-sdk/agent-framework#buildGoalContinuationPrompt',
  '@robota-sdk/agent-framework#buildGoalStartPrompt',
  '@robota-sdk/agent-framework#buildLanguageCommandSubcommands',
  '@robota-sdk/agent-framework#buildMemoryCommandSubcommands',
  '@robota-sdk/agent-framework#buildPermissionModeSubcommands',
  '@robota-sdk/agent-framework#buildPluginCommandSubcommands',
  '@robota-sdk/agent-framework#buildProviderProfile',
  '@robota-sdk/agent-framework#buildProviderSetupPatch',
  '@robota-sdk/agent-framework#buildRewindCommandSubcommands',
  '@robota-sdk/agent-framework#buildStatusLineCommandSubcommands',
  '@robota-sdk/agent-framework#cancelCommandBackgroundTask',
  '@robota-sdk/agent-framework#checkSettingsDocument',
  '@robota-sdk/agent-framework#checkSettingsFile',
  '@robota-sdk/agent-framework#clearCommandContextReferences',
  '@robota-sdk/agent-framework#clearConversationHistory',
  '@robota-sdk/agent-framework#closeCommandBackgroundTask',
  '@robota-sdk/agent-framework#compactCommandContext',
  '@robota-sdk/agent-framework#createBackgroundGroupExecutionEntryId',
  '@robota-sdk/agent-framework#createBackgroundTaskExecutionEntryId',
  '@robota-sdk/agent-framework#createCommandMemoryStores',
  '@robota-sdk/agent-framework#createCommandPendingMemoryStore',
  '@robota-sdk/agent-framework#createCommandProjectMemoryStore',
  '@robota-sdk/agent-framework#createExecutionOriginMetadata',
  '@robota-sdk/agent-framework#createGoalStatusTool',
  '@robota-sdk/agent-framework#createInteractiveRuntime',
  '@robota-sdk/agent-framework#createMainThreadExecutionEntryId',
  '@robota-sdk/agent-framework#createPluginRegistryReloadRequestedEffect',
  '@robota-sdk/agent-framework#createPluginTuiRequestedEffect',
  '@robota-sdk/agent-framework#createProviderFromSettings',
  '@robota-sdk/agent-framework#createScriptedProvider',
  '@robota-sdk/agent-framework#createSessionExitRequestedEffect',
  '@robota-sdk/agent-framework#createSessionPickerRequestedEffect',
  '@robota-sdk/agent-framework#createSessionRenamedEffect',
  '@robota-sdk/agent-framework#deleteProviderProfile',
  '@robota-sdk/agent-framework#extractGoalSignal',
  '@robota-sdk/agent-framework#findUnknownModuleNames',
  '@robota-sdk/agent-framework#formatCommandBackgroundTask',
  '@robota-sdk/agent-framework#formatCommandBackgroundTaskList',
  '@robota-sdk/agent-framework#formatCommandHelpMessage',
  '@robota-sdk/agent-framework#formatCommandPermissionsMessage',
  '@robota-sdk/agent-framework#formatCommandSessionReplayValidationReport',
  '@robota-sdk/agent-framework#formatEnvReference',
  '@robota-sdk/agent-framework#formatInvalidPermissionModeMessage',
  '@robota-sdk/agent-framework#formatLanguageUsageMessage',
  '@robota-sdk/agent-framework#formatProjectedModelCommandToolPromptDescription',
  '@robota-sdk/agent-framework#hasSensitiveCommandMemoryContent',
  '@robota-sdk/agent-framework#hasUsableSecretReference',
  '@robota-sdk/agent-framework#inspectCommandEditCheckpoint',
  '@robota-sdk/agent-framework#inspectUserLocalMemoryItem',
  '@robota-sdk/agent-framework#isCommandMemoryType',
  '@robota-sdk/agent-framework#isEnvReference',
  '@robota-sdk/agent-framework#isPermissionMode',
  '@robota-sdk/agent-framework#isSlashCommand',
  '@robota-sdk/agent-framework#isStatusLineCommandSettingsPatch',
  '@robota-sdk/agent-framework#listCommandBackgroundTasks',
  '@robota-sdk/agent-framework#listCommandContextReferences',
  '@robota-sdk/agent-framework#listCommandEditCheckpoints',
  '@robota-sdk/agent-framework#listCommandSessionAllowedTools',
  '@robota-sdk/agent-framework#listCommandUsedMemoryReferences',
  '@robota-sdk/agent-framework#mergeProviderPatch',
  '@robota-sdk/agent-framework#mergeProviders',
  '@robota-sdk/agent-framework#mergeSettings',
  '@robota-sdk/agent-framework#normalizeModelCommandName',
  '@robota-sdk/agent-framework#parseCommandBackgroundLogCursor',
  '@robota-sdk/agent-framework#parseExecutionWorkspaceEntryId',
  '@robota-sdk/agent-framework#parseInput',
  '@robota-sdk/agent-framework#parseLanguageArgument',
  '@robota-sdk/agent-framework#parsePermissionModeArgument',
  '@robota-sdk/agent-framework#parseSessionNameArgument',
  '@robota-sdk/agent-framework#probeProviderProfile',
  '@robota-sdk/agent-framework#readAutoCompactThreshold',
  '@robota-sdk/agent-framework#readAutoCompactThresholdSource',
  '@robota-sdk/agent-framework#readCommandBackgroundTaskLog',
  '@robota-sdk/agent-framework#readCommandContextState',
  '@robota-sdk/agent-framework#readCommandPermissionMode',
  '@robota-sdk/agent-framework#readCommandPermissionsState',
  '@robota-sdk/agent-framework#readCommandSessionInfo',
  '@robota-sdk/agent-framework#readMergedProviderSettings',
  '@robota-sdk/agent-framework#readMergedProviderSettingsFromPaths',
  '@robota-sdk/agent-framework#readProviderSettings',
  '@robota-sdk/agent-framework#readStatusLineSettings',
  '@robota-sdk/agent-framework#recordCommandMemoryEvent',
  '@robota-sdk/agent-framework#removeCommandContextReference',
  '@robota-sdk/agent-framework#resetAutoCompactThresholdSetting',
  '@robota-sdk/agent-framework#resolveActiveProvider',
  '@robota-sdk/agent-framework#resolveEnvDefaultProvider',
  '@robota-sdk/agent-framework#resolveEnvReference',
  '@robota-sdk/agent-framework#resolvePermissionModeAdapter',
  '@robota-sdk/agent-framework#resolvePluginCommandAdapter',
  '@robota-sdk/agent-framework#resolveProviderSettingsWriteTargetPath',
  '@robota-sdk/agent-framework#restoreCommandEditCheckpoint',
  '@robota-sdk/agent-framework#rollbackCommandEditCheckpoint',
  '@robota-sdk/agent-framework#sanitizeProviderProfileName',
  '@robota-sdk/agent-framework#scriptedSession',
  '@robota-sdk/agent-framework#selectCommandModules',
  '@robota-sdk/agent-framework#setCommandAutoCompactThreshold',
  '@robota-sdk/agent-framework#setCurrentProvider',
  '@robota-sdk/agent-framework#suggestProviderProfileName',
  '@robota-sdk/agent-framework#summarizeBackgroundJobGroup',
  '@robota-sdk/agent-framework#testProviderProfileCommand',
  '@robota-sdk/agent-framework#tokeniseSlashCommand',
  '@robota-sdk/agent-framework#upsertProviderProfile',
  '@robota-sdk/agent-framework#validateCommandSessionReplayLog',
  '@robota-sdk/agent-framework#validateProviderProfile',
  '@robota-sdk/agent-framework#writeAutoCompactThresholdSetting',
  '@robota-sdk/agent-framework#writeCommandPermissionMode',
  '@robota-sdk/agent-interface-transport#readAssistantReplies',
  '@robota-sdk/agent-interface-transport#readErrors',
  '@robota-sdk/agent-interface-transport#readLastAssistantText',
  '@robota-sdk/agent-interface-transport#readToolCalls',
  '@robota-sdk/agent-playground#CodeExecutor',
  '@robota-sdk/agent-playground#ExecutionSubscriber',
  '@robota-sdk/agent-playground#PLAYGROUND_WS_CLIENT_EVENTS',
  '@robota-sdk/agent-playground#PLAYGROUND_WS_MESSAGE_TYPES',
  '@robota-sdk/agent-playground#PlaygroundBlockCollector',
  '@robota-sdk/agent-playground#PlaygroundHistoryPlugin',
  '@robota-sdk/agent-playground#PlaygroundStatisticsPlugin',
  '@robota-sdk/agent-playground#PlaygroundWebSocketClient',
  '@robota-sdk/agent-playground#ProjectManager',
  '@robota-sdk/agent-playground#RealTimeLLMTracker',
  '@robota-sdk/agent-playground#UniversalToolFactory',
  '@robota-sdk/agent-playground#createBlockTrackingHooks',
  '@robota-sdk/agent-playground#createDelegationTrackingHooks',
  '@robota-sdk/agent-playground#createPlaygroundSandbox',
  '@robota-sdk/agent-playground#extractProviderInfo',
  '@robota-sdk/agent-playground#generateComplexDemoData',
  '@robota-sdk/agent-playground#generateDemoExecutionData',
  '@robota-sdk/agent-playground#generateMockEnvironment',
  '@robota-sdk/agent-playground#getPlaygroundConfig',
  '@robota-sdk/agent-playground#injectRemoteExecutor',
  '@robota-sdk/agent-playground#isFeatureEnabled',
  '@robota-sdk/agent-playground#logConfigurationStatus',
  '@robota-sdk/agent-playground#previewTransformation',
  '@robota-sdk/agent-playground#requiresTransformation',
  '@robota-sdk/agent-playground#validateFirebaseConfig',
  '@robota-sdk/agent-playground#validatePlaygroundConfig',
  '@robota-sdk/agent-plugin#ConsoleLogFormatter',
  '@robota-sdk/agent-plugin#ConsoleLogStorage',
  '@robota-sdk/agent-plugin#ConversationHistoryPlugin',
  '@robota-sdk/agent-plugin#DatabaseHistoryStorage',
  '@robota-sdk/agent-plugin#ErrorHandlingPlugin',
  '@robota-sdk/agent-plugin#ExecutionAnalyticsPlugin',
  '@robota-sdk/agent-plugin#FileHistoryStorage',
  '@robota-sdk/agent-plugin#FileLogStorage',
  '@robota-sdk/agent-plugin#FileUsageStorage',
  '@robota-sdk/agent-plugin#JsonLogFormatter',
  '@robota-sdk/agent-plugin#LimitsPlugin',
  '@robota-sdk/agent-plugin#LoggingPlugin',
  '@robota-sdk/agent-plugin#MemoryHistoryStorage',
  '@robota-sdk/agent-plugin#MemoryPerformanceStorage',
  '@robota-sdk/agent-plugin#MemoryUsageStorage',
  '@robota-sdk/agent-plugin#NodeSystemMetricsCollector',
  '@robota-sdk/agent-plugin#PerformancePlugin',
  '@robota-sdk/agent-plugin#RemoteLogStorage',
  '@robota-sdk/agent-plugin#RemoteUsageStorage',
  '@robota-sdk/agent-plugin#SilentLogStorage',
  '@robota-sdk/agent-plugin#SilentUsageStorage',
  '@robota-sdk/agent-plugin#UsagePlugin',
  '@robota-sdk/agent-plugin#WebhookHttpClient',
  '@robota-sdk/agent-plugin#WebhookPlugin',
  '@robota-sdk/agent-plugin#WebhookTransformer',
  '@robota-sdk/agent-plugin#aggregateExecutionStats',
  '@robota-sdk/agent-plugin#aggregateUsageStats',
  '@robota-sdk/agent-plugin#createPluginErrorContext',
  '@robota-sdk/agent-plugin#toErrorContext',
  '@robota-sdk/agent-provider-replay#ReplayProvider',
  '@robota-sdk/agent-provider-replay#createReplayProviderFromLogFile',
  '@robota-sdk/agent-session#replaySessionLogEntries',
  '@robota-sdk/agent-session#validateSessionReplayLogEntries',
  '@robota-sdk/agent-session-analytics#aggregateReports',
  '@robota-sdk/agent-session-analytics#analyzeSession',
  '@robota-sdk/agent-session-analytics#computeTimingIntervals',
  '@robota-sdk/agent-session-analytics#formatAggregateReport',
  '@robota-sdk/agent-session-analytics#formatSingleSession',
  '@robota-sdk/agent-session-analytics#formatUsageReport',
  '@robota-sdk/agent-session-analytics#gapMs',
  '@robota-sdk/agent-session-analytics#summarizeUsageBySource',
  '@robota-sdk/agent-tools#E2BSandboxClient',
  '@robota-sdk/agent-tools#InMemorySandboxClient',
  '@robota-sdk/agent-tools#applyWorkspaceManifest',
  '@robota-sdk/agent-tools#askUserQuestionTool',
  '@robota-sdk/agent-tools#bashTool',
  '@robota-sdk/agent-tools#createAskUserQuestionTool',
  '@robota-sdk/agent-tools#createBashTool',
  '@robota-sdk/agent-tools#createEditTool',
  '@robota-sdk/agent-tools#createFunctionTool',
  '@robota-sdk/agent-tools#createReadTool',
  '@robota-sdk/agent-tools#createShellTool',
  '@robota-sdk/agent-tools#createWriteTool',
  '@robota-sdk/agent-tools#createZodFunctionTool',
  '@robota-sdk/agent-tools#editTool',
  '@robota-sdk/agent-tools#globTool',
  '@robota-sdk/agent-tools#grepTool',
  '@robota-sdk/agent-tools#readTool',
  '@robota-sdk/agent-tools#shellTool',
  '@robota-sdk/agent-tools#validateWorkspaceManifestPath',
  '@robota-sdk/agent-tools#webFetchTool',
  '@robota-sdk/agent-tools#webSearchTool',
  '@robota-sdk/agent-tools#writeTool',
  '@robota-sdk/agent-transport#HeadlessInteractionChannel',
  '@robota-sdk/agent-transport#PrintTerminal',
  '@robota-sdk/agent-transport#ProgrammaticInteractionChannel',
  '@robota-sdk/agent-transport#TransportRegistry',
  '@robota-sdk/agent-transport#createHeadlessRunner',
  '@robota-sdk/agent-transport#createHeadlessTransport',
  '@robota-sdk/agent-transport#createProgrammaticAgent',
  '@robota-sdk/agent-transport#createScriptedProvider',
  '@robota-sdk/agent-transport#promptInput',
  '@robota-sdk/dag-adapters-sqlite#SqliteQueueAdapter',
  '@robota-sdk/dag-adapters-sqlite#SqliteStorageAdapter',
  '@robota-sdk/dag-api#DAG_API_PACKAGE_NAME',
  '@robota-sdk/dag-api#DagDesignController',
  '@robota-sdk/dag-api#DagDiagnosticsController',
  '@robota-sdk/dag-api#DagObservabilityController',
  '@robota-sdk/dag-api#DagRuntimeController',
  '@robota-sdk/dag-api#PromptApiController',
  '@robota-sdk/dag-api#RunProgressEventBus',
  '@robota-sdk/dag-api#createDagControllerComposition',
  '@robota-sdk/dag-api#toProblemDetails',
  '@robota-sdk/dag-api#toRuntimeProblemDetails',
  '@robota-sdk/dag-builder#DAG_BUILDER_PACKAGE_NAME',
  '@robota-sdk/dag-builder#buildDagFromPipeline',
  '@robota-sdk/dag-builder#fromDagWorkflowFile',
  '@robota-sdk/dag-builder#fromWorkflowNodeType',
  '@robota-sdk/dag-builder#isLegacyDefinitionFormat',
  '@robota-sdk/dag-builder#isWorkflowFileFormat',
  '@robota-sdk/dag-builder#toDagWorkflowFile',
  '@robota-sdk/dag-builder#toWorkflowNodeType',
  '@robota-sdk/dag-cli#runDagCli',
  '@robota-sdk/dag-core#EXECUTION_EVENT_PREFIX',
  '@robota-sdk/dag-core#SCHEDULER_EVENTS',
  '@robota-sdk/dag-core#SCHEDULER_EVENT_PREFIX',
  '@robota-sdk/dag-core#TASK_EVENTS',
  '@robota-sdk/dag-core#TASK_EVENT_PREFIX',
  '@robota-sdk/dag-core#TASK_PROGRESS_EVENTS',
  '@robota-sdk/dag-core#WORKER_EVENTS',
  '@robota-sdk/dag-core#WORKER_EVENT_PREFIX',
  '@robota-sdk/dag-core#isPromptLink',
  '@robota-sdk/dag-core#validateEdgesAndBindings',
  '@robota-sdk/dag-framework#DAG_FRAMEWORK_PACKAGE_NAME',
  '@robota-sdk/dag-framework#DagPromptBackend',
  '@robota-sdk/dag-framework#HttpDagRuntimeProvider',
  '@robota-sdk/dag-framework#LocalDagRuntimeProvider',
  '@robota-sdk/dag-framework#LocalFsAssetStore',
  '@robota-sdk/dag-framework#createDagFramework',
  '@robota-sdk/dag-framework#createDefaultNodeRegistry',
  '@robota-sdk/dag-framework#createDefaultNodeRegistrySync',
  '@robota-sdk/dag-framework#createExecutionComposition',
  '@robota-sdk/dag-framework#scanWorkspaceCatalog',
  '@robota-sdk/dag-mcp-server#callDagMcpTool',
  '@robota-sdk/dag-mcp-server#createDagMcpServer',
  '@robota-sdk/dag-mcp-server#createDagMcpToolDefinitions',
  '@robota-sdk/dag-mcp-server#resolveDagMcpConfig',
  '@robota-sdk/dag-mcp-server#runDagMcpServer',
  '@robota-sdk/dag-node#AbstractNodeDefinition',
  '@robota-sdk/dag-orchestration-client#DAG_ORCHESTRATION_CLIENT_PACKAGE_NAME',
  '@robota-sdk/dag-orchestration-client#DagOrchestrationHttpClient',
  '@robota-sdk/dag-projection#DAG_PROJECTION_PACKAGE_NAME',
  '@robota-sdk/dag-projection#ProjectionReadModelService',
  '@robota-sdk/dag-scheduler#DAG_SCHEDULER_PACKAGE_NAME',
  '@robota-sdk/dag-scheduler#SchedulerTriggerService',
  '@robota-sdk/dag-worker#DAG_WORKER_PACKAGE_NAME',
  '@robota-sdk/dag-worker#DlqReinjectService',
  '@robota-sdk/dag-worker#WorkerLoopService',
  '@robota-sdk/dag-worker#createWorkerLoopService',
]);

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const HEADING = /^#{2,6}\s+(.*)$/;
const PUBLIC_API_HEADING = /public api/i;
const TABLE_ROW = /^\s*\|(.+)\|\s*$/;
const SEPARATOR_ROW = /^\s*\|[\s|:-]+\|\s*$/;
const FIRST_BACKTICK_TOKEN = /`([^`]+)`/;

// Identifiers that are language/spec vocabulary, not package exports.
const VOCAB = new Set(['Export', 'Symbol', 'Kind', 'Type', 'Name', 'Component', 'Hook']);

function collectSrcText(srcDir) {
  let text = '';
  for (const entry of readdirSync(srcDir, { withFileTypes: true })) {
    const full = path.join(srcDir, entry.name);
    if (entry.isDirectory()) text += collectSrcText(full);
    else if (entry.isFile() && /\.(tsx|ts|mjs|cjs)$/.test(entry.name)) {
      text += readFileSync(full, 'utf8');
      text += '\n';
    }
  }
  return text;
}

function publicApiIdentifiers(specText) {
  const lines = specText.split('\n');
  const idents = [];
  let inPublicApi = false;
  for (const line of lines) {
    const heading = line.match(HEADING);
    if (heading) {
      inPublicApi = PUBLIC_API_HEADING.test(heading[1]);
      continue;
    }
    if (!inPublicApi) continue;
    if (SEPARATOR_ROW.test(line) || !TABLE_ROW.test(line)) continue;
    const cell = line.replace(/^\s*\|/, '').split('|')[0];
    const tokenMatch = cell.match(FIRST_BACKTICK_TOKEN);
    if (!tokenMatch) continue;
    const token = tokenMatch[1].trim();
    if (!IDENTIFIER.test(token) || VOCAB.has(token)) continue;
    idents.push(token);
  }
  return [...new Set(idents)];
}

function hasExportModifier(node) {
  return (node.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

/** Resolve a relative module specifier to its `.ts`/`.tsx` source file, or null. */
function resolveModuleFile(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec.replace(/\.(js|mjs)$/, ''));
  const candidates = [
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mts`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ];
  for (const candidate of candidates) if (existsSync(candidate)) return candidate;
  return null;
}

/**
 * Effective runtime export names of a module: direct runtime declarations plus names
 * surfaced by re-export edges (`export { … } from`, `export * from` resolved recursively).
 * Type-only exports are excluded. `seen` guards against `export *` cycles.
 */
function effectiveRuntimeExports(file, seen = new Set()) {
  const names = new Set();
  if (!file || seen.has(file) || !existsSync(file)) return names;
  seen.add(file);

  const sourceFile = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );

  for (const stmt of sourceFile.statements) {
    // Type-only declarations never contribute a runtime export.
    if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt)) continue;

    if (
      (ts.isFunctionDeclaration(stmt) ||
        ts.isClassDeclaration(stmt) ||
        ts.isEnumDeclaration(stmt)) &&
      hasExportModifier(stmt) &&
      stmt.name
    ) {
      // Default exports are anonymous surface, not table identifiers.
      const isDefault = (stmt.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
      if (!isDefault) names.add(stmt.name.text);
      continue;
    }

    if (ts.isVariableStatement(stmt) && hasExportModifier(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name)) names.add(decl.name.text);
      }
      continue;
    }

    if (ts.isExportDeclaration(stmt)) {
      if (stmt.isTypeOnly) continue; // `export type { … }`
      const modSpec =
        stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)
          ? stmt.moduleSpecifier.text
          : null;

      if (!stmt.exportClause) {
        // `export * from './x'` — enumerate the target's own runtime exports.
        if (modSpec) {
          for (const name of effectiveRuntimeExports(resolveModuleFile(file, modSpec), seen)) {
            names.add(name);
          }
        }
        continue;
      }

      if (ts.isNamedExports(stmt.exportClause)) {
        // `export { A, B as C }` / `export { A } from './x'` — surfaced (exported) names,
        // excluding inline `type`-qualified specifiers.
        for (const el of stmt.exportClause.elements) {
          if (el.isTypeOnly) continue;
          names.add(el.name.text);
        }
      }
    }
  }
  return names;
}

/** Entry source files a package actually ships (package.json exports/main + src/index.ts). */
function entrySourceFiles(pkgDir) {
  const files = new Set();
  const idx = path.join(pkgDir, 'src', 'index.ts');
  if (existsSync(idx)) files.add(idx);

  const ENTRY_BASENAMES = new Set(['index.ts', 'browser.ts', 'node.ts']);
  try {
    const pkg = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
    const visit = (value) => {
      if (typeof value === 'string') {
        if (value.startsWith('./src/')) {
          const resolved = path.resolve(pkgDir, value.replace(/\.(js|mjs)$/, '.ts'));
          if (existsSync(resolved) && ENTRY_BASENAMES.has(path.basename(resolved))) {
            files.add(resolved);
          }
        }
        return;
      }
      if (value && typeof value === 'object')
        for (const inner of Object.values(value)) visit(inner);
    };
    visit(pkg.exports ?? {});
    visit(pkg.main ?? null);
    visit(pkg.module ?? null);
  } catch {
    // allow-fallback: unreadable package.json is reported by other scans; entry falls back to src/index.ts
  }
  return [...files];
}

function packageName(pkgDir, root) {
  try {
    const name = JSON.parse(readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).name;
    if (typeof name === 'string') return name;
  } catch {
    // fall through to path key
  }
  return path.relative(root, pkgDir);
}

export async function findPublicSurfaceFindings(root = WORKSPACE_ROOT, options = {}) {
  const allowlist = options.allowlist ?? UNDOCUMENTED_EXPORT_ALLOWLIST;
  const findings = [];

  // Nesting-aware: covers depth-1 packages and nested group members (e.g. packages/dag-nodes/<name>).
  for (const pkgDir of listSpecPackageDirs(root)) {
    const specPath = path.join(pkgDir, 'docs', 'SPEC.md');
    const srcDir = path.join(pkgDir, 'src');
    if (!existsSync(srcDir)) continue;

    const specText = readFileSync(specPath, 'utf8');
    const idents = publicApiIdentifiers(specText);

    // FORWARD edge: every advertised identifier must appear in src/.
    if (idents.length > 0) {
      const srcText = collectSrcText(srcDir);
      for (const ident of idents) {
        const present = new RegExp(`\\b${ident}\\b`).test(srcText);
        if (!present) {
          findings.push({
            file: path.relative(root, specPath),
            type: 'spec-phantom-export',
            detail: `\`${ident}\` is advertised in the public-API table but appears nowhere in ${path.relative(root, srcDir)}.`,
          });
        }
      }
    }

    // REVERSE edge: every effective runtime export of the entry must be a table identifier.
    const entries = entrySourceFiles(pkgDir);
    if (entries.length === 0) continue;
    const tableIdents = new Set(idents);
    const pkgName = packageName(pkgDir, root);
    const runtimeExports = new Set();
    for (const entry of entries) {
      for (const name of effectiveRuntimeExports(entry)) runtimeExports.add(name);
    }
    for (const name of runtimeExports) {
      if (tableIdents.has(name)) continue;
      if (allowlist.has(`${pkgName}#${name}`)) continue;
      findings.push({
        file: path.relative(root, specPath),
        type: 'spec-undocumented-export',
        detail: `\`${name}\` is a runtime export of the package entry but is not listed in the public-API table.`,
      });
    }
  }
  return findings;
}

export async function main() {
  const findings = await findPublicSurfaceFindings(WORKSPACE_ROOT);
  if (findings.length === 0) {
    process.stdout.write('spec public-surface scan passed.\n');
    return;
  }
  process.stdout.write('spec public-surface scan failed:\n');
  for (const finding of findings) {
    process.stdout.write(`- [${finding.type}] ${finding.file}: ${finding.detail}\n`);
  }
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
