# @robota-sdk/agent-framework SPEC

## Scope

`@robota-sdk/agent-framework` is the assembly layer of the Robota SDK. It composes `agent-core`, `agent-session`, `agent-tools`, `agent-executor`, and the `agent-interface-transport` type contracts into a single, provider-neutral SDK surface. The primary entry point is `InteractiveSession({ cwd, provider })`. A `createQuery({ provider })` factory is also provided for single-shot prompt use.

This package owns: config loading (6-layer merge), context loading (AGENTS.md/CLAUDE.md walk-up), command infrastructure (command contracts, registry, sources), permission prompt, edit checkpointing, reversible execution policy, project memory store, self-hosting verification planner, skill discovery, background job orchestration, subagent assembly, bundle plugin management, and all SDK-specific type definitions.

This package does NOT own: provider implementations, generic session run loop, tool infrastructure, background task lifecycle state machine, permissions enforcement, hook execution, or React/Ink UI components.

## Boundaries

### What lives here

- `InteractiveSession` — event-driven composition over `Session`
- `createQuery()` — convenience single-shot factory
- `createAgentRuntime()` — runtime composition factory for headless and multi-session consumers
- Command infrastructure: `CommandRegistry`, `BuiltinCommandSource`, `SkillCommandSource`, `PluginCommandSource`, `SystemCommandExecutor`, `createSystemCommands()`
- Command API contracts: `ISystemCommand`, `ICommandModule`, `ICommandHostContext`, `ICommandResult`, `TCommandEffect`
- All `command-api/` sub-namespaces: provider, org-policy, context, compact, language, memory, background, help, permissions, statusline, plugin, session, effects, checkpoint
- Config loading: `loadConfig()` (internal), `readSettings()`, `writeSettings()`, settings I/O utilities
- Context loading: `loadContext()` (internal), task context helpers, prompt file reference resolver, context reference inventory
- Project memory: `ProjectMemoryStore`, the neutral `IMemoryStore` port + `FileSystemMemoryStore` reference adapter (SELFHOST-008), memory policy constants
- Edit checkpointing: `EditCheckpointStore`, `wrapEditCheckpointTools()`
- Reversible execution: `evaluateReversibleToolSafety()`, `wrapReversibleExecutionTools()`
- Self-hosting verification: `planSelfHostingVerification()`, `transitionSelfHostingLoop()`
- Evals-as-code (SELFHOST-011): the neutral eval-definition/runner surface — `defineEval()`, `runEval(def, runFn)`, and the default `createSessionRunFn(runtime)` (captures a session's `complete`-event `IExecutionResult`). A metric is a pure function over the SSOT `IExecutionResult` (`IMetric`; P3: `score(result, evalCase?)` threads the case so a per-case metric can read `evalCase.expected`); concrete metrics/datasets are consumer-supplied — NO eval content ships here. P3 adds **mechanism-only** helpers: metric factories `exactMatch`/`includesText`/`regexMatch`/`responseIsJson`/`usedTool`, the pure `parseEvalCases(text, format)` dataset parser, and the shared `formatEvalReport(report)` (the CLI adopts it).
- Background job orchestration: `BackgroundJobOrchestrator`, execution workspace projections
- Subagent assembly: `createSubagentSession()`, `createInProcessSubagentRunner()`, `createDefaultTools()`
- Multi-agent orchestration mechanism (SELFHOST-001): `runSequential()` / `runParallel()` / `runHandoff()` / `runHierarchical()` / `runGroupChat()` — IMPLEMENT the neutral orchestration contracts agent-core OWNS (`src/orchestration/`), composing over `agent-executor`'s `ISubagentManager`/`ISubagentRunner` port; spawn/wait/event mechanics are factored into `src/orchestration/shared.ts`. The framework never depends on `agent-subagent-runner` (would be a cycle); the concrete runner is injected at the `agent-cli` composition root. P1 ships `sequential`; P2 adds `parallel` (bounded concurrency + aggregation) and `handoff` (control-transfer); P3 adds `hierarchical` (manager-delegation) and `group-chat` (turn-taking) — completing the five named primitives.
- Bundle plugin management: `BundlePluginLoader`, `BundlePluginInstaller`, `MarketplaceClient`, `PluginSettingsStore`
- Agent tool: `createAgentTool()`, `storeAgentToolDeps()`, `retrieveAgentToolDeps()`
- Hook executors: `PromptExecutor`, `AgentExecutor`
- Permission prompt: `promptForApproval()`
- Path helpers: `projectPaths()`, `userPaths()`
- User-local storage: `resolveUserLocalStorageRoot()`, user-local memory APIs
- Testing utilities: exported from the `@robota-sdk/agent-framework/testing` subpath (not the
  runtime entry) — `scriptedSession()` / `ScriptedSessionHarness` (functional harness) and
  `createTestInteractiveSession()` (stub). See Test Strategy → Functional test harness.
- Update check: `checkForCliUpdate()`, related helpers
- Git utilities: `resolveGitBranch()`
- Semver utilities: `compareSemverVersions()`, `isNewerSemverVersion()`
- Runtime re-exports: NONE for contract types (INFRA-025) — background-task/subagent data contracts live in `@robota-sdk/agent-interface-transport` and are not re-exported here; the internal `background-tasks/`/`subagents/` barrels re-export only executor runtime SPI for intra-package organization.

### What does NOT live here

- `agent-core`: provider interface (`IAIProvider`), engine (`Robota`), history helpers, permissions enforcement (`evaluatePermission`), hook runner (`runHooks`), generic message utilities
- `agent-session`: `Session` class, `SessionStore`, `PermissionEnforcer`, `ContextWindowTracker`, `CompactionOrchestrator`, terminal output (`ITerminalOutput`)
- `agent-tools`: built-in tools (`shellTool`/`bashTool`, `readTool`, `writeTool`, etc.), tool creation infrastructure, sandbox client (`ISandboxClient`), `IToolInvocationResult`
- `agent-executor`: `BackgroundTaskManager`, `SubagentManager`, `WorktreeSubagentRunner`, lifecycle state machine
- `agent-provider-*`: provider implementations
- React/Ink components (belong in `agent-cli`)

### Forbidden imports

`agent-framework` must not import from `agent-provider-*` packages. The provider is always injected by the consumer.

## Architecture Overview

`agent-framework` sits above `agent-core`, `agent-session`, `agent-tools`, and `agent-executor` and provides a single assembly surface for building AI agent applications. See the "Architecture" section below for the full package dependency chain and feature layout.

Key design rules:

- **Assembly first**: all features are implemented by composing existing packages.
- **Provider-neutral**: the consumer (CLI, server, worker) creates the provider and passes it in.
- **React-free**: no React or Ink dependency; those belong in `agent-cli`.
- **No pass-through re-exports** (INFRA-025): the public index exposes framework-OWNED symbols only. Interface-transport-owned contract names (78 removed 2026-07-04) must be imported from `@robota-sdk/agent-interface-transport`; the `interface-imports` scan also catches `export … from` pass-throughs.

## Type Ownership

| Type                                                                  | Location                                                                                               | Purpose                                                                                                               |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `IInteractiveSession`                                                 | `src/interactive/i-interactive-session.ts`                                                             | Public interface for the event-driven session wrapper                                                                 |
| `TInteractiveSessionOptions`                                          | `src/interactive/interactive-session-options.ts`                                                       | Constructor options for `InteractiveSession`                                                                          |
| `IInteractiveSessionShutdownOptions`                                  | `src/interactive/interactive-session.ts`                                                               | Options for graceful session shutdown                                                                                 |
| `IInteractiveSessionEvents`                                           | `src/interactive/types.ts`                                                                             | Event map for all session events                                                                                      |
| `IInteractiveSessionRecord`                                           | `@robota-sdk/agent-interface-transport` (SSOT; DATA-001 — framework only imports + locally re-exports) | Persisted session record shape                                                                                        |
| `IInteractiveSessionStore`                                            | `@robota-sdk/agent-interface-transport` (SSOT; DATA-001 — framework only imports + locally re-exports) | Session persistence adapter interface                                                                                 |
| `IResumableSessionSummary`                                            | `@robota-sdk/agent-interface-transport` (SSOT; DATA-001 — framework only imports + locally re-exports) | Lightweight session summary for session picker                                                                        |
| `IToolState`                                                          | `src/interactive/types.ts`                                                                             | Tool execution state visible to clients                                                                               |
| `IDiffLine`                                                           | `src/interactive/types.ts`                                                                             | One diff line for Edit tool display metadata                                                                          |
| `IExecutionResult`                                                    | `src/interactive/types.ts`                                                                             | Result of a completed prompt execution                                                                                |
| `IToolSummary`                                                        | `src/interactive/types.ts`                                                                             | Summary of a tool call extracted from history                                                                         |
| `IUsageSnapshot`                                                      | `src/interactive/types.ts`                                                                             | Provider-neutral execution usage record                                                                               |
| `TPermissionResultValue`                                              | `src/interactive/types.ts`                                                                             | Permission handler result: `true`, `false`, `'allow-session'`, `'allow-project'`                                      |
| `TInteractivePermissionHandler`                                       | `src/interactive/types.ts`                                                                             | Client-provided permission approval callback                                                                          |
| `TInteractiveEventName`                                               | `src/interactive/types.ts`                                                                             | Union of all event names                                                                                              |
| `IContextFileRefreshedEvent`                                          | `src/interactive/types.ts`                                                                             | Event emitted when a context file is refreshed                                                                        |
| `ITransportAdapter`                                                   | `@robota-sdk/agent-interface-transport` (import from SSOT; no longer re-exported)                      | Common interface for transport adapters                                                                               |
| `IConfigurableTransport`                                              | `@robota-sdk/agent-interface-transport` (no longer re-exported — import from SSOT)                     | Transport with configurable options                                                                                   |
| `ITransportConfig`                                                    | `@robota-sdk/agent-interface-transport` (no longer re-exported — import from SSOT)                     | Transport configuration shape                                                                                         |
| `ISkillActivationEvent`                                               | `src/commands/skill-activation-events.ts`                                                              | Structured skill activation record                                                                                    |
| `ISystemCommand`                                                      | `src/command-api/contracts.ts`                                                                         | Command metadata and execute contract                                                                                 |
| `ICommandModule`                                                      | `src/command-api/command-module.ts`                                                                    | Composition unit for command modules                                                                                  |
| `ICommandHostContext`                                                 | `src/command-api/host-context.ts`                                                                      | Narrow facade for command module implementations                                                                      |
| `ICommandHostAdapters`                                                | `src/command-api/host-adapters.ts`                                                                     | Host-provided adapter bag                                                                                             |
| `ICommandResult`                                                      | `src/command-api/contracts.ts`                                                                         | Command output and typed host effects                                                                                 |
| `TCommandEffect`                                                      | `src/command-api/contracts.ts`                                                                         | Legacy typed effect union (CMD-004 Phase 2 splits it; deleted in Stage E)                                             |
| `TCommandHostAction` / `TCommandUiIntent`                             | `@robota-sdk/agent-interface-transport` (re-exported via `src/command-api/effects.ts`)                 | CMD-004 Phase 2 split contract: host-executed actions vs surface-rendered UI intents                                  |
| `IPresetApplicationOptions`                                           | `src/command-api/preset/preset-application.ts`                                                         | Framework-owned resolved-preset option subset re-applied to a live session (PRESET-011~017)                           |
| `IPresetApplicationResult`                                            | `src/command-api/preset/preset-application.ts`                                                         | `{ applied, skipped }` report from `applyPresetToSession`                                                             |
| `IModelReapplyOptions`                                                | `src/command-api/host-context.ts`                                                                      | Live model group (`model`/`effort`/`temperature`/`maxOutputTokens`) re-applied via `applyModelOptions` (PRESET-013)   |
| `TSystemPromptSectionSource`                                          | `src/context/system-prompt-types.ts`                                                                   | Source tag for a system-prompt section (`framework`, `persona`, `self-verification`, `runtime`, …)                    |
| `ICapabilityDescriptor`                                               | `src/capabilities/types.ts`                                                                            | Model-visible command descriptor                                                                                      |
| `TCapabilityKind`                                                     | `src/capabilities/types.ts`                                                                            | Capability kind union                                                                                                 |
| `TCapabilitySafety`                                                   | `src/capabilities/types.ts`                                                                            | Capability safety level                                                                                               |
| `IOrgPolicy`                                                          | `src/command-api/org-policy/`                                                                          | Org-level policy constraints                                                                                          |
| `IAgentRuntimeConfig`                                                 | `src/runtime/agent-runtime.ts`                                                                         | Configuration for `createAgentRuntime()`                                                                              |
| `IAgentRuntime`                                                       | `src/runtime/agent-runtime.ts`                                                                         | Runtime composition factory interface                                                                                 |
| `IHeadlessSessionOptions`                                             | `src/runtime/agent-runtime.ts`                                                                         | Per-session options for headless/multi-session use                                                                    |
| `IAgentDefinition`                                                    | `src/agents/index.ts`                                                                                  | Agent definition shape (name, description, systemPrompt, tools)                                                       |
| `IEditCheckpointSummary`                                              | `src/checkpoints/index.ts`                                                                             | Checkpoint summary for list/inspect                                                                                   |
| `IEditCheckpointInspection`                                           | `src/checkpoints/index.ts`                                                                             | Full checkpoint inspection with file list                                                                             |
| `IEditCheckpointRecorder`                                             | `src/checkpoints/index.ts`                                                                             | Port for checkpoint capture integration                                                                               |
| `IReversibleExecutionOptions`                                         | `src/reversible-execution/index.ts`                                                                    | Options for reversible execution mode                                                                                 |
| `IReversibleToolSafetyReport`                                         | `src/reversible-execution/index.ts`                                                                    | Classification report for a tool call                                                                                 |
| `ISelfHostingVerificationPlan`                                        | `src/self-hosting/index.ts`                                                                            | Ordered verification step plan                                                                                        |
| `TSelfHostingLoopState`                                               | `src/self-hosting/index.ts`                                                                            | Self-hosting lifecycle state                                                                                          |
| `IMetric` / `IEvalCase` / `IEvalDefinition`                           | `src/evals/eval-types.ts`                                                                              | SELFHOST-011: eval metric (pure fn over `IExecutionResult`), case, and definition (cases × metrics × threshold)       |
| `IEvalReport` / `IEvalCaseResult` / `IEvalMetricScore` / `TEvalRunFn` | `src/evals/eval-types.ts`                                                                              | SELFHOST-011: eval report/per-case result/per-metric score + the injected run-function type                           |
| `IBundlePluginManifest`                                               | `src/plugins/index.ts`                                                                                 | Plugin metadata: name, version, description                                                                           |
| `ILoadedBundlePlugin`                                                 | `src/plugins/index.ts`                                                                                 | Full bundle: manifest + tools, hooks, permissions, systemPrompt                                                       |
| `IPluginSettings`                                                     | `src/plugins/index.ts`                                                                                 | Plugin enable/disable settings                                                                                        |
| `IResolvedConfig`                                                     | `src/config/config-types.ts`                                                                           | Fully resolved SDK configuration                                                                                      |
| `TSettingsData`                                                       | `src/config/settings-io.ts`                                                                            | Generic settings document shape                                                                                       |
| `TSettingsScope`                                                      | `src/config/settings-io.ts`                                                                            | `'user'` or `'project-local'`                                                                                         |
| `IResetUserConfigResult`                                              | `src/config/reset-user-config.ts`                                                                      | Result of resetting user configuration                                                                                |
| `ITaskContextFile`                                                    | `src/context/task-context.ts`                                                                          | Discovered task file shape                                                                                            |
| `TTaskFileStatus`                                                     | `src/context/task-context.ts`                                                                          | Task status union                                                                                                     |
| `IPromptFileReferenceRecord`                                          | `src/context/prompt-file-references.ts`                                                                | Resolved prompt file reference metadata                                                                               |
| `TPromptFileReferenceDiagnosticCode`                                  | `src/context/prompt-file-references.ts`                                                                | Diagnostic code for reference errors                                                                                  |
| `IUserLocalStorageInspection`                                         | `src/user-local/index.ts`                                                                              | User-local storage inspection projection                                                                              |
| `IUserLocalMemoryItemProjection`                                      | `src/user-local/index.ts`                                                                              | Memory item with display/navigation metadata                                                                          |
| `TUserLocalMemoryCategory`                                            | `src/user-local/index.ts`                                                                              | Allowed user-local memory category union                                                                              |
| `IMemoryStore`                                                        | `src/memory/types.ts`                                                                                  | Neutral **async** durable-memory DIP port — composition of the four role interfaces below (SELFHOST-008 P1R)          |
| `IDurableMemoryReader`                                                | `src/memory/types.ts`                                                                                  | Read role — `loadStartupMemory`/`list`/`readTopic` (async)                                                            |
| `IMemoryWriter`                                                       | `src/memory/types.ts`                                                                                  | Write role — `append` (async)                                                                                         |
| `IMemoryRecaller`                                                     | `src/memory/types.ts`                                                                                  | Recall role — `recall(query, IMemoryBudget)` (async)                                                                  |
| `IMemoryCurationQueue`                                                | `src/memory/types.ts`                                                                                  | Curation-queue role — `getPending`/`listPending`/`markPending`/`upsertPending` (async)                                |
| `IMemoryBudget`                                                       | `src/memory/types.ts`                                                                                  | Recall budget (`maxTopics`/`maxTopicChars`)                                                                           |
| `IPerTurnRecallConfig`                                                | `src/memory/types.ts`                                                                                  | SELFHOST-008 P3: surface-supplied per-turn recall policy (`budget`); presence enables per-turn recall (adapter-gated) |
| `ISemanticMemoryAdapter`                                              | `src/memory/types.ts`                                                                                  | Duck-typed semantic/vector memory backend port (P4); consumed by `SemanticMemoryStore`                                |
| `ISemanticMemoryQueryResult`                                          | `src/memory/types.ts`                                                                                  | A semantic recall hit                                                                                                 |
| `ISkillPromptContext`                                                 | `src/utils/skill-prompt.ts`                                                                            | Variable substitution context for skill prompts                                                                       |
| `ICliUpdateNotice`                                                    | `src/update-check/update-check.ts`                                                                     | CLI update notification data                                                                                          |
| `TCliUpdateCheckResult`                                               | `src/update-check/update-check.ts`                                                                     | Result of a CLI update check                                                                                          |

## Public API Surface

Core classes and functions exported from `@robota-sdk/agent-framework`:

| Export                                      | Kind     | Description                                                                                                                                                                                                                                                   |
| ------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `InteractiveSession`                        | class    | Primary SDK entry point; event-driven session wrapper                                                                                                                                                                                                         |
| `resolveRoleModel`                          | function | SELFHOST-006: resolve a role's PRIMARY `IModelRef` from a `TRoleModelMap` (opaque key; undefined if unmapped)                                                                                                                                                 |
| `resolveRoleFallbackChain`                  | function | SELFHOST-006: the role's full ordered fallback chain (primary first); empty if unmapped                                                                                                                                                                       |
| `runWithRoleFallback`                       | function | SELFHOST-006: walk a role's fallback chain, trying each `IModelRef` over the provider DIP until one succeeds (alternate provider+model on error)                                                                                                              |
| `createQuery`                               | function | Single-shot prompt factory (`({ provider }) => (prompt) => result`)                                                                                                                                                                                           |
| `createAgentRuntime`                        | function | Headless/multi-session runtime composition factory                                                                                                                                                                                                            |
| `createStatelessRuntime`                    | function | Filesystem-free runtime for serverless/embedded contexts (no session store, no-op settings, bare sessions by default)                                                                                                                                         |
| `buildRuntimeSession`                       | function | RUNTIME-001: the single session-construction seam — builds an `InteractiveSession` from resolved `TInteractiveSessionOptions` (used by the TUI, print, and `--serve`)                                                                                         |
| `startRuntimeHost`                          | function | RUNTIME-001: presentation-free runtime host — builds the session + owns the transport `startAll/stopAll` + bounded shutdown handle (used by the headless `robota --serve`)                                                                                    |
| `createProjectSessionStore`                 | function | Project-local session store facade                                                                                                                                                                                                                            |
| `createUserSessionStore`                    | function | User-level session store facade (`~/.robota/sessions`)                                                                                                                                                                                                        |
| `listResumableSessionSummaries`             | function | List saved sessions for session picker UI                                                                                                                                                                                                                     |
| `generateSessionName`                       | function | LLM-based session auto-naming (prompt/policy owned here; transports invoke + apply via `setName`). NEUT-005: default sanitizer is Unicode-aware (non-Latin titles survive); `IGenerateSessionNameOptions` injects a custom naming prompt and/or sanitizer     |
| `resolveLatestSessionId`                    | function | Resolve the most recent session ID                                                                                                                                                                                                                            |
| `resolveSessionIdByIdOrName`                | function | Resolve session ID by ID or user-visible name                                                                                                                                                                                                                 |
| `CommandRegistry`                           | class    | Aggregates `ICommandSource` instances for slash command discovery                                                                                                                                                                                             |
| `BuiltinCommandSource`                      | class    | SDK core compatibility command source (currently empty)                                                                                                                                                                                                       |
| `SkillCommandSource`                        | class    | Discovers SKILL.md files for virtual skill palette metadata                                                                                                                                                                                                   |
| `PluginCommandSource`                       | class    | Discovers commands exposed by installed bundle plugins                                                                                                                                                                                                        |
| `SystemCommandExecutor`                     | class    | Registry and executor for `ISystemCommand` instances                                                                                                                                                                                                          |
| `createSystemCommands`                      | function | SDK core command factory (returns empty list; built-ins are in command modules)                                                                                                                                                                               |
| `createBuiltinCommandModule`                | function | SDK core compatibility module factory                                                                                                                                                                                                                         |
| `applyPresetToSession`                      | function | Live preset-switching engine: re-applies a resolved preset's option groups to a running session, records the active preset id, returns `{ applied, skipped }` (PRESET-011~017)                                                                                |
| `parseFrontmatter`                          | function | YAML frontmatter parser for skill/agent definition files                                                                                                                                                                                                      |
| `executeSkill`                              | function | Internal skill execution helper                                                                                                                                                                                                                               |
| `createSkillExecutionPort`                  | function | Build the concrete `ISkillExecutionPort` (skill discovery + resolution) for injection at a composition root (ARCH-PROVIDER-005)                                                                                                                               |
| `createDefaultRemoteCommandPolicy`          | function | Build the **allow-by-default** `IRemoteCommandPolicy` for remote-origin commands (local == remote; an optional custom policy may restrict; REMOTE-006)                                                                                                        |
| `loadOrgPolicy`                             | function | Read org policy from `~/.robota/org-policy.json`                                                                                                                                                                                                              |
| `formatOrgPolicyViolationMessage`           | function | Format a human-readable org policy violation message                                                                                                                                                                                                          |
| `isApiKeyPlaintext`                         | function | Check whether an API key value is a plaintext secret                                                                                                                                                                                                          |
| `ProjectMemoryStore`                        | class    | Project memory CRUD store backed by `.robota/memory/`                                                                                                                                                                                                         |
| `FileSystemMemoryStore`                     | class    | Neutral filesystem reference adapter implementing the `IMemoryStore` port (SELFHOST-008); composes project/pending/recall stores                                                                                                                              |
| `createFileSystemMemoryStore`               | function | Factory for the neutral fs `IMemoryStore` reference adapter (the default when no store is injected)                                                                                                                                                           |
| `SemanticMemoryStore`                       | class    | SELFHOST-008 P4: neutral decorator `implements IMemoryStore` composing a base store + injected `ISemanticMemoryAdapter` — tiered recall (semantic primary, keyword fallback), guarded append-then-index (skip on dedup), delegate rest; imports no vector SDK |
| `createSemanticMemoryStore`                 | function | Factory: `createSemanticMemoryStore(base, adapter)` (mirrors `createFileSystemMemoryStore`); the surface injects it via the existing `memoryStore` seam                                                                                                       |
| `isMemoryType`                              | function | Type guard for `TMemoryType`                                                                                                                                                                                                                                  |
| `EditCheckpointStore`                       | class    | Edit checkpoint store backed by `.robota/checkpoints/`                                                                                                                                                                                                        |
| `wrapEditCheckpointTools`                   | function | Wrap Write/Edit tools to snapshot pre-images before mutation                                                                                                                                                                                                  |
| `planSelfHostingVerification`               | function | Generate ordered verification steps for self-modifying runs                                                                                                                                                                                                   |
| `transitionSelfHostingLoop`                 | function | Pure state machine transition for the self-hosting loop                                                                                                                                                                                                       |
| `defineEval`                                | function | SELFHOST-011: validate + normalize an eval definition (default threshold 1)                                                                                                                                                                                   |
| `runEval`                                   | function | SELFHOST-011: run each case through the injected `runFn`, score with each metric over `IExecutionResult`, aggregate to a pass/fail report                                                                                                                     |
| `createSessionRunFn`                        | function | SELFHOST-011: build the default eval `runFn` from `createAgentRuntime().createSession()` (captures the `complete`-event `IExecutionResult`)                                                                                                                   |
| `exactMatch`                                | function | SELFHOST-011 P3: neutral `IMetric` factory — response equals expected (closure or per-case `evalCase.expected`)                                                                                                                                               |
| `includesText`                              | function | SELFHOST-011 P3: neutral `IMetric` factory — response contains a substring                                                                                                                                                                                    |
| `regexMatch`                                | function | SELFHOST-011 P3: neutral `IMetric` factory — response matches a regex                                                                                                                                                                                         |
| `responseIsJson`                            | function | SELFHOST-011 P3: neutral `IMetric` factory — response parses as JSON                                                                                                                                                                                          |
| `usedTool`                                  | function | SELFHOST-011 P3: neutral `IMetric` factory — the run used a named tool                                                                                                                                                                                        |
| `parseEvalCases`                            | function | SELFHOST-011 P3: pure dataset-text parser (`json`/`jsonl`) → `IEvalCase[]` (no library file I/O)                                                                                                                                                              |
| `formatEvalReport`                          | function | SELFHOST-011 P3: neutral shared report renderer (the `robota eval` CLI adopts it)                                                                                                                                                                             |
| `evaluateReversibleToolSafety`              | function | Classify a tool call by reversibility and isolation requirements                                                                                                                                                                                              |
| `wrapReversibleExecutionTools`              | function | Wrap tools with reversible execution enforcement                                                                                                                                                                                                              |
| `PluginSettingsStore`                       | class    | Plugin enable/disable settings store                                                                                                                                                                                                                          |
| `BundlePluginLoader`                        | class    | Load a bundle plugin from a directory path                                                                                                                                                                                                                    |
| `BundlePluginInstaller`                     | class    | Install/uninstall bundle plugins under user or project scope                                                                                                                                                                                                  |
| `MarketplaceClient`                         | class    | Plugin discovery and install from remote marketplace                                                                                                                                                                                                          |
| `BUILT_IN_AGENTS`                           | const    | Array of built-in agent definitions (`general-purpose`, `Explore`, `Plan`)                                                                                                                                                                                    |
| `getBuiltInAgent`                           | function | Look up a built-in agent by name                                                                                                                                                                                                                              |
| `createDefaultTools`                        | function | Assemble default built-in tools (exported for CLI fork composition)                                                                                                                                                                                           |
| `createSubagentSession`                     | function | Assemble an isolated child session for subagent execution                                                                                                                                                                                                     |
| `createSubagentLogger`                      | function | Create an append-only subagent transcript logger                                                                                                                                                                                                              |
| `assembleSubagentPrompt`                    | function | Assemble the full system prompt for a subagent session                                                                                                                                                                                                        |
| `getSubagentSuffix`                         | function | Framework suffix for standard subagent system prompts                                                                                                                                                                                                         |
| `getForkWorkerSuffix`                       | function | Framework suffix for fork-worker (skill context: fork) prompts                                                                                                                                                                                                |
| `resolveSubagentLogDir`                     | function | Resolve the log directory for a subagent                                                                                                                                                                                                                      |
| `createAgentTool`                           | function | Create the SDK-specific agent sub-session tool                                                                                                                                                                                                                |
| `storeAgentToolDeps`                        | function | Store agent tool runtime dependencies in session context                                                                                                                                                                                                      |
| `retrieveAgentToolDeps`                     | function | Retrieve stored agent tool runtime dependencies                                                                                                                                                                                                               |
| `createCommandExecutionTool`                | function | Legacy model command execution tool factory (compatibility)                                                                                                                                                                                                   |
| `createModelCommandToolProjection`          | function | Project command descriptors to provider-safe tool definitions                                                                                                                                                                                                 |
| `createProjectedCommandExecutionTools`      | function | Create projected command tools from descriptors                                                                                                                                                                                                               |
| `createProviderSafeModelCommandToolName`    | function | Normalize a command name to a provider-safe tool name                                                                                                                                                                                                         |
| `createBackgroundProcessTool`               | function | Create the model-callable `BackgroundProcess` tool                                                                                                                                                                                                            |
| `BackgroundJobOrchestrator`                 | class    | SDK grouping/wait layer above `BackgroundTaskManager`                                                                                                                                                                                                         |
| `createExecutionWorkspaceSnapshot`          | function | Build a presentation-neutral execution workspace snapshot                                                                                                                                                                                                     |
| `createExecutionWorkspaceTaskSpawner`       | function | Build an origin-bound task spawning port                                                                                                                                                                                                                      |
| `createLineDetailPage`                      | function | Build a cursor-based detail page for a task log                                                                                                                                                                                                               |
| `createMainThreadDetailPage`                | function | Build a detail page for the main thread transcript                                                                                                                                                                                                            |
| `createInProcessSubagentRunner`             | function | Default in-process subagent runner adapter                                                                                                                                                                                                                    |
| `runSequential`                             | function | SELFHOST-001 — run a `sequential` orchestration over `agent-executor`'s `ISubagentManager`/`ISubagentRunner` port; emits neutral lifecycle events over the event-service                                                                                      |
| `runParallel`                               | function | SELFHOST-001 P2 — run a `parallel` orchestration (bounded concurrency via `maxConcurrency` + order-preserving aggregation) over the same subagent port                                                                                                        |
| `runHandoff`                                | function | SELFHOST-001 P2 — run a `handoff` orchestration (control-transfer among steps via an injected neutral `resolveHandoff` policy; `maxHandoffs` loop bound)                                                                                                      |
| `runHierarchical`                           | function | SELFHOST-001 P3 — run a `hierarchical` (manager-delegation) orchestration: a manager step delegates to workers via an injected `planDelegation` policy; `maxRounds` loop bound                                                                                |
| `runGroupChat`                              | function | SELFHOST-001 P3 — run a `group-chat` (turn-taking) orchestration: steps take turns chosen by an injected `selectNextStep` policy; `maxTurns` loop bound                                                                                                       |
| `PlanController`                            | class    | SELFHOST-002 — pure plan-mode phase controller (`planning`→`awaiting-approval`→`executing`→`completed`); returns `{ action, nextMode }` decisions, never sets permission mode                                                                                 |
| `PromptExecutor`                            | class    | Hook executor: injects a prompt into session context                                                                                                                                                                                                          |
| `AgentExecutor`                             | class    | Hook executor: creates a nested agent session for hook input                                                                                                                                                                                                  |
| `promptForApproval`                         | function | Terminal permission approval prompt                                                                                                                                                                                                                           |
| `projectPaths`                              | function | Structured project-local paths under `.robota/`                                                                                                                                                                                                               |
| `userPaths`                                 | function | Structured user-local paths under `~/.robota/`                                                                                                                                                                                                                |
| `resolveUserLocalStorageRoot`               | function | Validate and resolve the user-local storage root                                                                                                                                                                                                              |
| `inspectUserLocalStorage`                   | function | Return a structured inspection of user-local storage                                                                                                                                                                                                          |
| `setUserLocalMemoryItem`                    | function | Write a user-local memory item                                                                                                                                                                                                                                |
| `listUserLocalMemoryItems`                  | function | List user-local memory items                                                                                                                                                                                                                                  |
| `readEnabledUserLocalMemoryItem`            | function | Read an enabled memory item (returns `null` when disabled)                                                                                                                                                                                                    |
| `disableUserLocalMemoryItem`                | function | Disable a user-local memory item                                                                                                                                                                                                                              |
| `deleteUserLocalMemoryItem`                 | function | Delete a user-local memory item                                                                                                                                                                                                                               |
| `substituteVariables`                       | function | Substitute `$VAR` / `${VAR}` placeholders in a skill prompt                                                                                                                                                                                                   |
| `preprocessShellCommands`                   | function | Extract shell commands embedded in skill prompt text                                                                                                                                                                                                          |
| `discoverTaskFiles`                         | function | Discover active `.agents/tasks/*.md` files                                                                                                                                                                                                                    |
| `loadTaskContext`                           | function | Load, select, and format task context for the system prompt                                                                                                                                                                                                   |
| `parseTaskFile`                             | function | Parse a task Markdown file                                                                                                                                                                                                                                    |
| `selectRelevantTasks`                       | function | Select the most relevant task files for the current session                                                                                                                                                                                                   |
| `formatTaskContext`                         | function | Format selected tasks as neutral system prompt metadata                                                                                                                                                                                                       |
| `updateTaskFileStatus`                      | function | Update task status and append a dated progress entry                                                                                                                                                                                                          |
| `readCurrentGitBranch`                      | function | Read the current Git branch for task selection                                                                                                                                                                                                                |
| `buildPromptWithFileReferences`             | function | Expand `@file` references in a prompt string                                                                                                                                                                                                                  |
| `resolvePromptFileReferences`               | function | Resolve `@file` reference tokens to file content                                                                                                                                                                                                              |
| `parsePromptFileReferences`                 | function | Parse `@file` reference tokens from a prompt string                                                                                                                                                                                                           |
| `resolvePromptFileReferencePaths`           | function | Resolve paths for prompt file references                                                                                                                                                                                                                      |
| `formatPromptFileReferenceDiagnostics`      | function | Format diagnostics for file reference errors                                                                                                                                                                                                                  |
| `hasBlockingPromptFileReferenceDiagnostics` | function | Check whether any reference diagnostic blocks sending                                                                                                                                                                                                         |
| `toPromptFileReferenceRecords`              | function | Convert resolved references to structured records                                                                                                                                                                                                             |
| `createPromptFileReferenceHistoryEntry`     | function | Build a history entry for prompt file reference metadata                                                                                                                                                                                                      |
| `listActiveContextReferences`               | function | List active context references from the inventory                                                                                                                                                                                                             |
| `upsertContextReference`                    | function | Add or update a context reference in the inventory                                                                                                                                                                                                            |
| `removeContextReference`                    | function | Remove a context reference from the inventory                                                                                                                                                                                                                 |
| `clearContextReferences`                    | function | Clear all context references from the inventory                                                                                                                                                                                                               |
| `createContextReferenceItem`                | function | Build a context reference item shape                                                                                                                                                                                                                          |
| `toContextReferenceRecords`                 | function | Convert context references to structured records                                                                                                                                                                                                              |
| `createTestInteractiveSession`              | function | (moved to the `./testing` subpath) Create a stub `IInteractiveSession` for tests                                                                                                                                                                              |
| `getUserSettingsPath`                       | function | Return the user-global settings file path                                                                                                                                                                                                                     |
| `resolveSettingsPathForScope`               | function | Resolve settings path for `'user'` or `'project-local'` scope                                                                                                                                                                                                 |
| `readSettings`                              | function | Read a settings JSON file                                                                                                                                                                                                                                     |
| `writeSettings`                             | function | Write a settings JSON file                                                                                                                                                                                                                                    |
| `updateModelInSettings`                     | function | Update the active model in a settings file                                                                                                                                                                                                                    |
| `deleteSettings`                            | function | Delete a settings file                                                                                                                                                                                                                                        |
| `resetUserConfig`                           | function | Reset user configuration to defaults                                                                                                                                                                                                                          |
| `getProviderSettingsPaths`                  | function | Return the ordered provider settings file paths                                                                                                                                                                                                               |
| `resolveGitBranch`                          | function | Resolve the current Git branch name                                                                                                                                                                                                                           |
| `compareSemverVersions`                     | function | Compare two semver version strings                                                                                                                                                                                                                            |
| `isNewerSemverVersion`                      | function | Check whether a version is newer than another                                                                                                                                                                                                                 |
| `readPackageVersion`                        | function | Read the package version from `package.json`                                                                                                                                                                                                                  |
| `checkForCliUpdate`                         | function | Check npm for a newer version of the CLI                                                                                                                                                                                                                      |
| `formatCliUpdateCheckMessage`               | function | Format a CLI update check result as a string                                                                                                                                                                                                                  |
| `formatCliUpdateNotice`                     | function | Format a CLI update notice for display                                                                                                                                                                                                                        |
| `getStartupCliUpdateNotice`                 | function | Get an update notice string for startup display                                                                                                                                                                                                               |
| `getUserUpdateCheckCachePath`               | function | Return the path for the CLI update check cache                                                                                                                                                                                                                |
| `readUpdateCheckCache`                      | function | Read the CLI update check cache                                                                                                                                                                                                                               |
| `writeUpdateCheckCache`                     | function | Write the CLI update check cache                                                                                                                                                                                                                              |
| `shouldRunStartupCliUpdateCheck`            | function | Decide whether to run a startup update check                                                                                                                                                                                                                  |

## Extension Points

### Command Modules (`ICommandModule`)

The primary extension point. Any host or third-party package can contribute commands, command sources, model-visible descriptors, and session requirements by implementing `ICommandModule` and passing it to `InteractiveSession({ commandModules })` or `createAgentRuntime({ commandModules })`.

```typescript
interface ICommandModule {
  name: string;
  commandSources?: readonly ICommandSource[];
  systemCommands?: readonly ISystemCommand[];
  commandDescriptors?: readonly ICapabilityDescriptor[];
  sessionRequirements?: readonly TCommandModuleSessionRequirement[];
}
```

Current requirement: `'agent-runtime'` (the sole `TCommandModuleSessionRequirement` value) — enables agent definitions and shared background/subagent managers.

### Transport Adapters (`ITransportAdapter`)

Any consumer can attach a transport adapter to expose the session over HTTP, WebSocket, MCP, or any other protocol:

```typescript
session.attachTransport(transport); // ITransportAdapter from @robota-sdk/agent-interface-transport
await transport.start();
```

### Hook Executors

The internal assembly factory `createSession()` accepts custom `IHookTypeExecutor` implementations (`additionalHookExecutors`) alongside the SDK-built-in `PromptExecutor` and `AgentExecutor`. Executors are keyed by hook type string and receive hook configuration plus a JSON payload. This seam is internal-assembly-level only: `createSession()` is not exported, and the public `InteractiveSession` options do not expose executor injection.

### Bundle Plugins

`BundlePluginLoader`/`BundlePluginInstaller` provide a plugin system where reusable extensions (tools, hooks, permissions, system prompt additions) can be packaged as installable bundles under `~/.robota/plugins/` (user) or `.robota/plugins/` (project).

### Permission Handler

Consumers provide a `permissionHandler` callback (`TInteractivePermissionHandler`) to `InteractiveSession` options to intercept tool permission requests with custom UI instead of the built-in terminal prompt.

### Subagent Runner Factory (`TSubagentRunnerFactory`)

Runtime shells can inject a factory to replace the default in-process subagent runner with a process-backed or worktree-isolated runner, via the public `InteractiveSession` options or `createAgentRuntime` config:

```typescript
new InteractiveSession({ cwd, provider, subagentRunnerFactory: myFactory });
// or
createAgentRuntime({ cwd, provider, subagentRunnerFactory: myFactory });
```

### Sandbox Client (`ISandboxClient`)

When `sandboxClient` is provided to `InteractiveSession`, Bash, Read, Write, and Edit tools are created through sandbox-aware factories that route I/O through the injected client.

### Interaction Channel Contract (`IInteractionChannel`)

`agent-framework` defines the channel abstraction that decouples session I/O from transport implementations. Transport packages implement `IInteractionChannel`; `createInteractiveRuntime` wires them to a session.

```typescript
interface IInteractionChannel {
  onSubmit(handler: (text: string) => Promise<void>): void;
  write(event: InteractionEvent): void;
  askUser(request: IActionRequest): Promise<TActionResponse>;
  setAvailableCommands(commands: ICommandInfo[]): void;
  setBusy(busy: boolean): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}
```

**`InteractionEvent`** — one-way display events pushed by the framework to the channel:

| Event type            | When emitted                       |
| --------------------- | ---------------------------------- |
| `user-message`        | User text submitted                |
| `assistant-chunk`     | AI token delta                     |
| `assistant-done`      | Streaming complete, with full text |
| `tool-call`           | Tool invocation started            |
| `tool-result`         | Tool invocation finished           |
| `permission-resolved` | Permission granted or denied       |
| `command-result`      | Slash command executed             |
| `error`               | Session error                      |

**`askUser(IActionRequest)` (CMD-004)** — the sole "ask the user" seam. The unified action contract (`IActionRequest`/`TActionResponse`) is owned by `agent-core` and reaches both command execution and tool execution. The channel renders the request per-environment (Ink dialog, web modal, programmatic preset) and resolves when the user answers or cancels. `createInteractiveRuntime` injects it into the session as `askHandler`, so a command reaches it via `context.getUserInteraction()?.ask(request)`; the runtime itself does **not** disambiguate commands — each command solicits any input it needs.

**`createInteractiveRuntime`** — factory that wires a channel to a session:

- Registers command modules and exposes their commands via `setAvailableCommands`
- Routes user messages → `session.submit()`
- Routes slash commands → `session.executeCommand()` (commands self-ask via the injected `askHandler`)
- Forwards session events → `channel.write(InteractionEvent)`
- Calls `setBusy(true/false)` around AI completions

`agent-framework` does **not** own: Ink rendering, web socket connections, dialog HTML, or any channel implementation. Those live in transport packages.

### Live preset application seams (PRESET-011~017)

`agent-framework` owns the engine that switches a preset on an **already-running** session, plus the
optional host/runtime contract higher layers implement to receive each re-applied option group. The
`/preset` command (in `agent-command`) resolves a preset with `agent-preset` and hands the result
straight to `applyPresetToSession` — no framework → agent-preset dependency.

**`applyPresetToSession(context, presetId, options): IPresetApplicationResult`** — the single
live-preset-switching entry point. It first records the active preset id (PRESET-011, via the
runtime's optional `setActivePresetId`), then re-applies each option group it owns and reports which
groups were `applied` vs. `skipped` (a group absent from `options` is left untouched and listed under
`skipped`).

**`IPresetApplicationOptions`** is a framework-owned shape that `agent-preset`'s
`IResolvedPresetOptions` satisfies **structurally** (so the framework never imports agent-preset — no
dependency cycle). Fields and the group each drives:

| Field                                               | Group / seam used                                                                                                                                                                                    |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `permissionMode`                                    | PRESET-012 — `writeCommandPermissionMode` seam                                                                                                                                                       |
| `model`, `effort`, `temperature`, `maxOutputTokens` | PRESET-013 — runtime `applyModelOptions(IModelReapplyOptions)`                                                                                                                                       |
| `persona`                                           | PRESET-014 — host `applyPersona(persona)`                                                                                                                                                            |
| `enabledCommandModules`, `disabledCommandModules`   | PRESET-015 — host `applyCommandModuleSelection(enabled, disabled)` → `readonly IUnknownCommandModuleName[]` (INFRA-032: unmatched names carried on `IPresetApplicationResult.unknownCommandModules`) |
| `enableParallelSubagents`                           | PRESET-016 — runtime `setParallelSubagentsEnabled(enabled)`                                                                                                                                          |
| `selfVerification`                                  | PRESET-017 — host `applySelfVerification(enabled)`                                                                                                                                                   |

`IPresetApplicationResult` is `{ applied: readonly string[]; skipped: readonly string[] }`.

**Optional `ICommandSessionRuntime` methods** (the runtime contract higher layers implement):
`getActivePresetId?()`, `setActivePresetId?(id)`, `applyModelOptions?(opts)`,
`setParallelSubagentsEnabled?(enabled)` (`src/command-api/host-context.ts`).

**Optional `ICommandHostContext` methods**: `applyPersona?(persona)`,
`applyCommandModuleSelection?(enabled, disabled)`, `applySelfVerification?(enabled)`,
`getUserInteraction?()`.

**Ask seam (CMD-004)**: consumers provide an `askHandler` callback (`IUserInteraction['ask']`, SSOT in
`@robota-sdk/agent-core`) to `InteractiveSession` options — the interaction sibling of
`permissionHandler`. The session exposes it to command modules as a narrow capability via
`ICommandHostContext.getUserInteraction(): IUserInteraction | undefined`, which returns `undefined`
when no interactive renderer is attached (headless/automation) — a command treats absence as "no human
available", never a silent guess. `createUserInteractionPort()`
(`src/interaction/user-interaction-port.ts`) wraps the handler with the model-invocation guard: a
command invoked by the model runs inside an executing turn, so the port resolves `cancelled` instead of
blocking on a human prompt. Transports render the `IActionRequest` per-environment; the contract carries
no function-valued fields (serialization-safe for remote transports).

**Model-question seam (CMD-005)**: the same `askHandler` is additionally threaded — session assembly
(`createSession` `ask` option) → agent-session `ISessionOptions.ask` → `IAgentConfig.ask` — into every
per-tool-call `IToolExecutionContext.ask`, which the `AskUserQuestion` built-in tool (agent-tools)
consumes to let the model ask the user structured questions mid-turn (the channel's queued ask renderer
already works while a turn is executing, like permission prompts). The command-path model-invocation
guard above is unchanged — the tool is the one model path. Headless sessions inject no handler, so the
tool resolves a structured `unavailable` result.

**`createSelfVerificationSection()`** (`src/context/system-prompt-section-providers.ts`) composes a
verify-before-done system-prompt section with `source: 'self-verification'` at **priority 6** — between
`persona` (priority 5) and AGENTS.md project instructions (priority 10) — emitted only when
`selfVerification` is true. `'self-verification'` is a member of `TSystemPromptSectionSource`.

**`selectCommandModules(modules, enabled, disabled)`** — pure allow-then-deny filter for live
command-module re-selection (deny wins over allow; neither given returns the input unchanged). This is
the **single** framework-owned filter implementation: agent-command's `applyModuleSelection` now
delegates to it (allowed command→framework edge, INFRA-032), so the previously byte-identical copy is
collapsed.

**`findUnknownModuleNames(availableNames, enabled?, disabled?)`** (INFRA-032) — pure detection
primitive beside `selectCommandModules`. Returns one `{ name, kind: 'enabled' | 'disabled' }` entry
per `enabled`/`disabled` name that is not in `availableNames` (`[]` when all match). It is the single
source of the unmatched-name detection reused by **both** preset entry points: the startup `--preset`
path (via agent-command's `createDefaultCommandModules`, which returns `{ modules, unknownModuleNames }`)
and the in-session `/preset` path (via `SessionSkillRouter.reapplyCommandModuleSelection`, whose return
threads through the host-context `applyCommandModuleSelection` seam and `IPresetApplicationResult.unknownCommandModules`
so the `/preset` command surfaces a non-fatal notice). An unmatched name — a short form like `"editor"`
instead of `agent-command-editor`, or a typo — is surfaced, never silently dropped.

Both `selectCommandModules` and `findUnknownModuleNames` are re-exported from the package root
(`src/index.ts`) so agent-command can reuse them, along with the shared `IUnknownCommandModuleName`
result type.

## Provider Resolution Order

`readProviderSettings(cwd, options)` resolves the active provider configuration in this
order — the first hit wins:

1. **Settings documents** (`resolveActiveProvider` over the merged settings paths): an
   explicit profile always wins.
2. **Env-default synthesis** (`resolveEnvDefaultProvider(definitions, env)`): when no
   profile resolves, the first provider definition (in definition order) whose
   `defaults.apiKey` is a `$ENV:<NAME>` reference with `env[<NAME>]` set non-empty AND
   whose `defaults.model` exists yields an in-memory config flagged `source: 'env-default'`.
   The key is **resolved** from the env map (profile-path parity — `resolveActiveProvider`
   also returns resolved keys via `normalizeProviderConfig`); the env var NAME travels in
   the dedicated `sourceEnvVar` field so callers can name the variable without touching the
   value. `defaults.baseURL`/`timeout`/`options` are carried over. Nothing is persisted.
   Definitions without an `$ENV:` apiKey default or without a default model are never
   synthesized. `env` is injectable (default `process.env`).
3. **`ProviderConfigError`**: thrown when neither resolves.

Settings files on the merge-chain paths are read fail-fast (CLI-069): a missing file is a
non-error (skipped / empty defaults), but an EXISTING file that fails to parse throws
`SettingsParseError` (typed; carries `filePath` and the JSON parse message, with fix/delete

- `robota diagnose` remediation in the message). Corrupt is never treated as missing — both
  `provider-merge.readSettingsFile` and `config/settings-io.readSettings` enforce this; the
  old warn-and-continue path is removed. Session start propagates the error (exit 1 at the
  CLI); reporting consumers (e.g. diagnose) catch it and present it as a finding.

Callers can detect `source === 'env-default'` and read `sourceEnvVar` to render a one-line
startup notice naming provider/model/env-var — never the key value.

## Turn Error Surfacing & Liveness (ERR-001)

Layered contract: classification lives in the provider (typed errors), humanization in this
package (`humanizeApiError`, SSOT), turn recovery in the interactive controller, rendering in each
transport, and process survival in the product assembly.

- A failed turn commits any partially streamed answer to history as an **interrupted assistant
  entry** before the stream state clears — a mid-stream failure never evaporates the partial text.
- The error history entry is humanized and machine-marked with `metadata.kind: 'error'` so
  transports can render a styled error block instead of a plain system note.
- `InteractiveSession.reportBackgroundError(error, source?)` surfaces errors from OUTSIDE the turn
  boundary (background tasks, catalog refresh, un-caught promises) through the same humanize →
  marked-entry → `'error'` event path; the session stays fully usable. Product assemblies route
  process-level guards here (agent-cli SPEC → Process Survival Boundary).

## Error Taxonomy

The package defines two named `Error` subclasses: `ProviderConfigError` (missing/unusable
provider configuration at session start — thrown by `readProviderSettings` and by
`agent-command`'s `ensureProviderConfig`; the CLI maps it to a distinct exit code in print
mode) and `SettingsParseError` (existing settings file with invalid JSON — see §Provider
Resolution Order; generic exit 1 at the CLI). All other errors propagate from underlying
packages and from SDK assembly validation:

| Error Source                  | Category                    | Description                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider resolution           | `ProviderConfigError`       | No settings profile and no env-default synthesis candidate (see §Provider Resolution Order)                                                                                                                                                                                                                                                                                                                                 |
| Settings file parsing         | `SettingsParseError`        | Existing settings file with invalid JSON — fail-fast with file path + parse message (CLI-069); never treated as missing                                                                                                                                                                                                                                                                                                     |
| `agent-session`               | `SessionRunError`           | Unrecoverable error during `session.run()`                                                                                                                                                                                                                                                                                                                                                                                  |
| `agent-core`                  | `PermissionDeniedError`     | Tool call denied by permission policy                                                                                                                                                                                                                                                                                                                                                                                       |
| Config loading                | `TypeError` / thrown string | Missing `type` field in provider profile; unknown `currentProvider` key                                                                                                                                                                                                                                                                                                                                                     |
| Configure-provider validation | thrown `Error`              | CLI-068 causal-order diagnosis: unknown provider type → `Unknown provider "<type>". Supported providers: <list from definitions SSOT>`; `--api-key-env` referencing an unset variable → `Environment variable <VAR> is not set — set it before configuring (the profile will reference $ENV:<VAR>)` — the variable MUST be set at configure time; genuinely missing fields keep the original `is missing <field>` diagnosis |
| Prompt file references        | blocking diagnostic         | Missing file, outside-root, circular, max-depth, or size-limit violations; prompt is rejected before being sent                                                                                                                                                                                                                                                                                                             |
| Org policy                    | thrown string               | `allowedProviders` or `requireApiKeyFromEnv` violation detected at command dispatch                                                                                                                                                                                                                                                                                                                                         |
| Reversible execution          | thrown `Error`              | Local-first mode blocks a tool that lacks required isolation                                                                                                                                                                                                                                                                                                                                                                |
| Checkpoint restore            | thrown `Error`              | Restore attempted while a prompt is running                                                                                                                                                                                                                                                                                                                                                                                 |
| User-local storage            | thrown `Error`              | Empty root, relative root, root equal to the active repository, or root inside the active repository                                                                                                                                                                                                                                                                                                                        |
| `BackgroundTaskManager`       | `BackgroundTaskError`       | Typed error with category and recoverability (re-exported from `agent-executor`)                                                                                                                                                                                                                                                                                                                                            |

All errors from `session.run()` are caught by `InteractiveSession` and emitted as an `error` event rather than thrown from `submit()`.

## Test Strategy

### Test coverage (as of 2026-05)

- 82 test files across `src/__tests__/` and `src/interactive/__tests__/`
- Key test files:
  - `interactive-session.test.ts` — InteractiveSession behavior: submit, abort, queue, history
  - `interactive-session-background-tasks.test.ts` — background task events and controls
  - `interactive-session-checkpoints.test.ts` — edit checkpoint capture and restore
  - `interactive-session-skill-command.test.ts` — skill command routing
  - `interactive-session-streaming.test.ts` — streaming text delta accumulation
  - `session-persistence.test.ts` — session store save/restore
  - `e2e-scenarios.test.ts` — end-to-end scenarios with mock provider
  - `config-loader.test.ts` — 6-layer settings merge and `$ENV:` substitution
  - `context-loader.test.ts` — AGENTS.md/CLAUDE.md discovery
  - `permission-gate.test.ts` — permission mode evaluation
  - `hook-wiring.test.ts` — hook lifecycle integration
  - `public-api.test.ts` — ensures forbidden symbols are not exposed in the public barrel
  - `provider-settings.test.ts` — provider profile merge and validation
  - `skill-prompt.test.ts` — variable substitution and shell command preprocessing

### Functional test harness — `@robota-sdk/agent-framework/testing` (TEST-003)

The `./testing` subpath (kept out of the runtime bundle) is the agent's standard way to **functionally
verify a feature at the framework level** — the CLI is a thin wrapper and must not be where feature
behaviour is verified.

- `scriptedSession({ turns | cassette | record, files?, persistence?, cwd?, resumeSessionId?,
forkSession?, model?, commandModules?, ... })` / `ScriptedSessionHarness` builds a **real**
  `InteractiveSession` (real agent loop, builtin tools, persistence, events) in an isolated temp
  workspace. Provider modes (exactly one): **scripted** (`turns`, hand-written, SSOT
  `createScriptedProvider`), **cassette** (`cassette: path`, a recorded real-model run replayed
  deterministically — TEST-005; a committed real Qwen goal run is at
  `__fixtures__/goal-satisfied.cassette.json`, recorded by
  `packages/agent-cli/scripts/record-goal-cassette.mts`), or **record**
  (`record: { provider, toCassette }`, capture a real provider run). Multi-session: `cwd` +
  `resumeSessionId` (+ `forkSession`) open a second harness over the same workspace store to
  resume/fork a persisted session; the harness only deletes a workspace it created. No CLI, no
  network, no live LLM (replay/scripted).
- Drivers: `submit(prompt)` → awaits the completed turn; `runGoal(objective, opts)` → awaits the
  stopped goal; `awaitEvent(name, predicate?)`.
- Inspectors — in-memory: `history()`, `toolCalls()`, `emittedEvents(name)`, `requests`. Durable
  artifacts the system itself writes (leverage these): `sessionRecord()` (the persisted session JSON),
  `transcript()` / `logEntries()` (the real `{cwd}/.robota/logs/{sessionId}.jsonl` transcript —
  `session_init` / `provider_request` / `tool_call` / `tool_result` / `assistant` records), and
  `readFile()`/`exists()`/`files()` (workspace side effects). Lifecycle: `dispose()` tears down the
  workspace. Scripted tool-call args may use the `{{cwd}}` placeholder for absolute workspace paths.
- `createTestInteractiveSession()` (same subpath) remains a lightweight **stub** for wiring/type tests
  that do not need the real loop.

### Approach

- Unit tests use a mock `IAIProvider` from `@robota-sdk/agent-core` test utilities; no real API calls
- Functional/feature tests use the `./testing` harness above against a real session (no CLI)
- Integration tests (`cross-package-hooks.test.ts`, `cross-package-skills.test.ts`) use real `createSession()` with mock providers to verify hook wiring and skill routing
- Public API surface test (`public-api.test.ts`) acts as a regression guard: it asserts that lower-package symbols are not accidentally re-exported

### Gaps

- No test for full sandbox client lifecycle (snapshot + restore)
- No test for `MarketplaceClient` network behavior (requires network mock)
- No test for worktree subagent runner (requires Git mock)

## Class Contract Registry

### Interface Implementations

| Interface                 | Implementation                                                      | Package           |
| ------------------------- | ------------------------------------------------------------------- | ----------------- |
| `IInteractiveSession`     | `InteractiveSession`                                                | `agent-framework` |
| `IAgentRuntime`           | returned by `createAgentRuntime()` (anonymous object)               | `agent-framework` |
| `IEditCheckpointRecorder` | `EditCheckpointStore`                                               | `agent-framework` |
| `ITransportAdapter`       | implementations in `agent-transport-*` packages                     | external          |
| `ISubagentRunner`         | `createInProcessSubagentRunner()`                                   | `agent-framework` |
| `ISubagentRunner`         | `WorktreeSubagentRunner` (decorator)                                | `agent-executor`  |
| `IBackgroundTaskRunner`   | adapters provided by runtime shells                                 | external          |
| `ICommandSource`          | `BuiltinCommandSource`, `SkillCommandSource`, `PluginCommandSource` | `agent-framework` |
| `IBundlePluginManifest`   | validated by `BundlePluginLoader`                                   | `agent-framework` |

### Inheritance Chains

| Class                       | Inherits from                                    | Notes                                        |
| --------------------------- | ------------------------------------------------ | -------------------------------------------- |
| `InteractiveSession`        | `InteractiveSessionBase`                         | Composition over `Session` (not inheritance) |
| `InteractiveSessionBase`    | `EventEmitter` (Node.js)                         | Provides `on`, `off`, `emit`                 |
| `EditCheckpointStore`       | none                                             | Plain class                                  |
| `BackgroundJobOrchestrator` | none                                             | Plain class                                  |
| `PromptExecutor`            | implements `IHookTypeExecutor` from `agent-core` | —                                            |
| `AgentExecutor`             | implements `IHookTypeExecutor` from `agent-core` | —                                            |

### Cross-Package Port Consumers

| Port (interface)         | Owner package               | Consumed by (in agent-framework)                             |
| ------------------------ | --------------------------- | ------------------------------------------------------------ |
| `IAIProvider`            | `agent-core`                | `InteractiveSession`, `createSession()`, `createQuery()`     |
| `ISession`               | `agent-core`                | `InteractiveSession` (implements)                            |
| `Session`                | `agent-session`             | `createSession()`, `createSubagentSession()`                 |
| `ISandboxClient`         | `agent-tools`               | `InteractiveSession` options, `createSession()`              |
| `IBackgroundTaskManager` | `agent-executor`            | `InteractiveSession`, `BackgroundJobOrchestrator`            |
| `ISubagentRunner`        | `agent-executor`            | `createInProcessSubagentRunner()`, `createSubagentSession()` |
| `IHookTypeExecutor`      | `agent-core`                | `PromptExecutor`, `AgentExecutor`                            |
| `ITransportAdapter`      | `agent-interface-transport` | `InteractiveSession.attachTransport()`                       |

---

## Overview

Robota SDK is a programming SDK built by **assembling** existing Robota packages.
It is provider-neutral: the consumer (CLI, server, worker, etc.) creates the provider and passes it to the SDK.
The primary entry point is `InteractiveSession({ cwd, provider })`. A `createQuery({ provider })` factory is also provided for single-shot prompt use.

## Core Principles

1. **Assembly first**: All features are implemented using existing packages. Independent implementation is prohibited.
2. **No duplication**: If the same functionality exists in an existing package, use it. Refactor the existing package if needed.
3. **Connection required**: All features in agent-framework must be connected to the Robota package ecosystem.
4. **General/specialized separation**: General-purpose features (permissions, hooks, tools) belong in their respective packages; only SDK-specific features (config, context) are kept in agent-framework.
5. **React-free**: `agent-framework` is a pure TypeScript package. React hooks, React context, and React
   components must never be added to this package. React/Ink belongs in product shells
   (`agent-cli`) and command packages (`agent-command-*`). This keeps the SDK usable in any
   TypeScript context — CLI, web server, worker, test — without a React dependency.
6. **Assembly layer, not a re-export layer**: The SDK composes sessions, runtime, tools, and core
   into a single SDK surface. Pass-through re-exports are only permitted through explicit SDK facade
   barrels (`background-tasks/`, `subagents/`). General-purpose symbols must be imported from their
   owner packages, not tunnelled through the SDK.

## Architecture

### Package Dependency Chain

```
agent-core           ← types, abstractions, utilities (unchanged)
agent-executor       ← background task + subagent lifecycle primitives (unchanged)
agent-session        ← Session, permissions, compaction (unchanged)
agent-tools          ← tool infrastructure + 8 built-in tools (unchanged)
agent-provider-*     ← provider implementations (unchanged)

agent-framework      ← InteractiveSession (single entry point)
  ├── embedded: SystemCommandExecutor (session.executeCommand())
  ├── embedded: CommandRegistry, BuiltinCommandSource, SkillCommandSource, PluginCommandSource
  ├── common API: command effects/interactions, lifecycle metadata, session replay validation, provider settings/profile helpers
  ├── common API: prompt file-reference parsing, resolution, diagnostics, and structured records
  ├── common API: skill discovery, skill metadata, and skill activation host context
  ├── extension: ICommandModule command/source/session-requirement injection
  ├── optional: agent runtime deps + AgentDefinitionLoader when a module requests agent-executor
  ├── composed: agent-executor BackgroundTaskManager, SubagentManager, runner ports
  ├── internal: createSession(), createDefaultTools(), loadConfig(), loadContext()
  ├── optional: sandboxClient injection for sandbox-aware built-in tool execution
  ├── optional: workspaceManifest application through agent-tools sandbox ports
  ├── optional: sandbox snapshot hydration through agent-tools sandbox ports
  ├── exposed: createQuery({ provider }) → (prompt) => result
  └── NO provider dependency (provider-neutral)

agent-command-*      ← built-in/optional command modules
  ├── consumes SDK command interfaces
  ├── consumes SDK common APIs like third-party modules
  └── NO dependency from agent-framework back to command modules

agent-cli            ← minimal TUI
  ├── creates provider (reads config, picks provider package)
  ├── selects product-default command modules such as @robota-sdk/agent-command and @robota-sdk/agent-command
  ├── creates InteractiveSession({ cwd, provider, commandModules })
  ├── subscribes to events → renders to terminal
  └── owns: slash prefix parsing, Ink components, paste handling, CJK input
```

SDK is provider-neutral. The consumer (CLI, server, etc.) creates the provider and passes it to the SDK. Assembly (wiring tools, provider, system prompt) happens inside the SDK, but the provider itself comes from the consumer.

SDK command code is split between generic infrastructure and command-facing common APIs. The SDK responsibility is the command contract layer: command contracts, registries/executors, lifecycle metadata, effects/interactions, reusable command-facing common APIs, and skill discovery/activation services consumed by command modules. User-visible internal commands, including `/skills`, must be implemented as command modules selected by composition roots.

### Client–SDK–Session Relationship

```
Any client (CLI, web, API server, worker)
    │
    │  1. creates provider:  new AnthropicProvider({ apiKey })
    │  2. creates session:   new InteractiveSession({ cwd, provider })
    │  3. subscribes:        session.on('text_delta', ...)
    ↓
InteractiveSession  (agent-framework — pure TypeScript, no React)
    │  submit(input, displayInput?, rawInput?)
    │  executeCommand(name, args)
    │  executeSkillCommandByName(name, args, request)  // host API used by /skills
    │  abort() / cancelQueue()
    │  getMessages() / getContextState() / getActiveTools()
    │  (config/context loaded internally from cwd)
    ↓
Session  (agent-session — generic run loop)
    ↓
Robota engine + Provider  (agent-core / agent-provider-*)

agent-cli (Ink TUI — thin bridge layer)
    creates provider → passes to InteractiveSession({ cwd, provider, commandModules })
    subscribes to InteractiveSession events → maps to React/Ink state
    routes /commands → session.executeCommand()
```

The SDK layer has **no React dependency** and **no provider dependency**. The CLI is a TUI-only layer that creates the provider and bridges InteractiveSession events to React state.

### Package Roles

| Package               | Role                                                                                                                                    | General/Specialized |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| **agent-core**        | Robota engine, execution loop, provider abstraction, permissions, hooks                                                                 | General             |
| **agent-executor**    | Background task and subagent lifecycle primitives, runner ports, worktree runner decorator                                              | General             |
| **agent-tools**       | Tool creation infrastructure, sandbox execution ports, and 8 built-in tools                                                             | General             |
| **agent-session**     | Generic Session class, SessionStore (persistence)                                                                                       | General             |
| **agent-framework**   | Assembly layer: InteractiveSession (single entry point), command contracts/common APIs, createQuery(), config, context                  | SDK-specific        |
| **agent-command-\***  | Built-in/optional command modules that consume SDK command interfaces/common APIs and can be selected by composition roots              | Command-specific    |
| **agent-cli**         | Ink TUI and product composition. Creates provider, selects command modules, passes both to InteractiveSession. No agent-session import. | CLI-specific        |
| **agent-provider-\*** | AI provider implementations. CLI depends on these directly; SDK does not.                                                               | Provider-specific   |

### Feature Layout (Current Implementation State)

```
agent-core
├── src/permissions/          ← permission-gate, permission-mode, types
├── src/hooks/                ← hook-runner, hook types
└── (existing) Robota, execution, providers, plugins

agent-executor (reusable runtime primitives — depends on agent-core, agent-interface-transport, agent-process)
├── src/background-tasks/     ← BackgroundTaskManager, state machine, task runner ports
└── src/subagents/            ← SubagentManager, subagent runner port, worktree runner decorator

agent-tools
├── src/builtins/             ← bash, read, write, edit, glob, grep, web-fetch, web-search tools
├── src/sandbox/              ← ISandboxClient, workspace manifest contracts, snapshot ports, E2B structural adapter, and in-memory contract adapter
├── packages/agent-tools/src/types/tool-result.ts  ← IToolInvocationResult
└── (existing) FunctionTool, createZodFunctionTool, schema conversion

agent-session (generic — depends on agent-core and agent-interface-transport)
├── packages/agent-session/src/session.ts                ← Session: orchestrates run loop, delegates to sub-components
├── packages/agent-session/src/permission-enforcer.ts    ← PermissionEnforcer: tool wrapping, permission checks, hooks, truncation
├── packages/agent-session/src/context-window-tracker.ts ← ContextWindowTracker: token usage, auto-compact threshold
├── packages/agent-session/src/compaction-orchestrator.ts ← CompactionOrchestrator: conversation summarization via LLM
├── packages/agent-session/src/session-logger.ts         ← ISessionLogger + FileSessionLogger / SilentSessionLogger
├── packages/agent-session/src/session-store.ts          ← SessionStore (JSON file persistence)
└── packages/agent-session/src/index.ts

agent-framework (assembly layer — SDK-specific features only)
├── src/interactive/
│   ├── interactive-session.ts  ← InteractiveSession: event-driven wrapper over Session
│   ├── session-persistence.ts  ← SDK-owned session store facade and resumable-session summaries
│   └── types.ts                ← IToolState, IExecutionResult, IInteractiveSessionEvents
├── src/command-api/            ← Command module contracts, host context, effects/interactions, session/provider/model common APIs
│   ├── contracts.ts            ← ISystemCommand + lifecycle metadata
│   ├── command-module.ts       ← ICommandModule composition contract
│   ├── host-context.ts         ← ICommandHostContext narrow facade for command modules
│   ├── host-adapters.ts        ← generic host adapter contracts
│   ├── provider/               ← provider settings/profile/setup/probe common APIs
│   ├── model/                  ← provider-aware model catalog common APIs and refresh orchestration
│   ├── session/                ← session-history and replay-validation command common APIs
│   └── background/             ← background task command common APIs
├── src/commands/
│   ├── command-registry.ts     ← CommandRegistry: aggregates ICommandSource instances
│   ├── builtin-source.ts       ← BuiltinCommandSource: SDK core compatibility source; currently empty
│   ├── skill-source.ts         ← SkillCommandSource: discovers SKILL.md files
│   ├── plugin-source.ts        ← PluginCommandSource: discovers plugin commands (moved from agent-cli)
│   └── system-command.ts       ← SDK core command factory; currently empty because user-visible built-ins are command modules
├── src/assembly/               ← Session factory: createSession (internal), createDefaultTools (internal)
├── src/config/                 ← settings.json loading (6-layer merge, $ENV substitution)
├── src/context/                ← AGENTS.md/CLAUDE.md/memory discovery, project detection, system prompt
│   ├── context-reference-inventory.ts ← session context reference metadata, active/observed status, and bounded inventory policy
│   ├── prompt-file-reference-*.ts ← `@file` prompt reference parser/resolver, path policy, formatting, and diagnostics
│   └── task-context.ts         ← active `.agents/tasks/*.md` discovery, selection, formatting, and status updates
├── src/memory/                 ← project memory store, reusable capture policy, retrieval services
├── src/user-local/             ← user-local storage root validation, category projections, and baseline memory persistence
├── src/checkpoints/            ← edit checkpoint store + Write/Edit tool snapshot wrapper
├── src/self-hosting/           ← self-hosting verification planner + lifecycle state machine
├── src/tools/agent-tool.ts     ← Agent sub-session tool (SDK-specific: uses createSession)
├── src/subagents/              ← SDK in-process runner + explicit compatibility exports from agent-executor
├── src/background-tasks/       ← explicit compatibility exports from agent-executor
├── src/permissions/            ← permission-prompt.ts (terminal approval prompt)
├── src/paths.ts                ← projectPaths / userPaths helpers
├── src/types.ts                ← internal terminal type aliases; not a top-level public barrel
├── src/query.ts                ← createQuery() factory (provider-neutral; provider injected by consumer)
└── src/index.ts                ← SDK-owned APIs plus explicit SDK facade exports

agent-cli (Ink TUI — CLI-specific)
├── src/ui/                     ← App, MessageList, InputArea, StatusBar, PermissionPrompt,
│                                  SlashAutocomplete, CjkTextInput, WaveText, InkTerminal, render
├── src/permissions/            ← permission-prompt.ts (terminal arrow-key selection)
├── src/types.ts                ← ITerminalOutput, ISpinner (duplicate — SSOT is agent-session)
├── packages/agent-cli/src/cli.ts                  ← CLI argument parsing, Ink render
└── packages/agent-cli/src/bin.ts                  ← Binary entry point
```

## Feature Details

### Session Management

- **Package**: `agent-session` (generic, depends on agent-core and agent-interface-transport)
- **Implementation**: Session accepts pre-constructed tools, provider, and system message. Internal concerns are delegated to PermissionEnforcer, ContextWindowTracker, and CompactionOrchestrator.
- **Assembly**: `agent-framework/assembly/` provides `createSession()` (internal — not exported) which wires tools, provider, and system prompt from config/context. Consumers use `InteractiveSession({ cwd, provider })` instead.
- **Persistence**: `SessionStore` defaults to `~/.robota/sessions/{id}.json` for generic session consumers. SDK exposes `createProjectSessionStore(cwd)` and resumable-session helpers so CLI composition can use project-local `.robota/sessions` without importing `agent-session` directly.
- **Replay validation common API**: SDK command APIs expose `validateCommandSessionReplayLog()` and formatting helpers that load the current session's project-local `.robota/logs/{sessionId}.jsonl` file through `agent-session` replay validators. Command modules consume this API; `agent-cli` must not read replay logs or implement replay validation directly.

### Permission System

- **Package**: `agent-core` (general-purpose security layer)
- **Implementation**: 3-step evaluation — deny list → allow list → mode policy
- **Modes**: `plan` (read-only), `default` (write requires approval), `acceptEdits` (write auto-approved), `bypassPermissions` (all auto-approved)
- **Pattern syntax**: `Bash(pnpm *)`, `Read(/src/**)`, `Write(*)` etc. with glob matching
- **Terminal prompt**: `agent-framework/src/permissions/permission-prompt.ts` is the SSOT implementation of the terminal approval prompt. Used by both `InteractiveSession`/`createQuery()` and `agent-cli` (which imports from `@robota-sdk/agent-framework`). Presents 3 options: **Allow once** (returns `true`), **Allow for this session** (returns `'allow-session'`), **Deny** (returns `false`).
- **Session-level allow**: `PermissionEnforcer` maintains an in-memory `sessionAllowedTools` set. When a permission handler or `promptForApprovalFn` returns `'allow-session'`, the tool name is added to this set and all future calls for that tool in the same session are auto-approved without prompting. The set is cleared by `clearSessionAllowedTools()` and discarded on session end (never persisted).
- **Project-level allow**: When a handler returns `'allow-project'`, `PermissionEnforcer` adds the tool to `sessionAllowedTools` (same-session convenience) and calls `onProjectAllowTool(toolName)`. The `createSession()` factory wires `onProjectAllowTool` to append `ToolName(*)` to `.robota/settings.local.json` permissions.allow.
- **TUI permission prompt**: `PermissionPrompt.tsx` in `agent-transport` presents 4 options: **Allow** (once), **Allow always (this session)** (`a` shortcut), **Allow always (this project)** (`p` shortcut), **Deny** (`n`/`d` shortcut). The TUI uses `permissionHandler` (React async queue) rather than `promptForApprovalFn`.
- **Default allow patterns**: `createSession()` automatically adds allow patterns for config folder access: `Read(.agents/**)`, `Read(.claude/**)`, `Read(.robota/**)`, `Glob(.agents/**)`, `Glob(.claude/**)`, `Glob(.robota/**)`. These are merged with user-configured permissions.

### Hooks System

- **Package**: `agent-core` (general-purpose extension points)
- **Events**: `PreToolUse`, `PostToolUse`, `PreCompact`, `PostCompact`, `SessionStart`, `Stop`
- **Implementation**: Executes shell commands, passes JSON via stdin, determines allow(0)/deny(2) by exit code
- **Matcher**: Tool name regex pattern matching

### Tool System

- **Infrastructure**: `agent-tools` (createZodFunctionTool, FunctionTool, Zod→JSON conversion)
- **Built-in tools**: `agent-tools/builtins/` — Bash, Read, Write, Edit, Glob, Grep, WebFetch, WebSearch
- **Agent runtime deps**: `agent-framework/tools/agent-tool.ts` stores reusable subagent runtime dependencies for `/agent` and `context: fork` skill execution when a composed command module requests `agent-executor`. `createSession()` does not register a separate model-visible `Agent` tool; model and user routing use the built-in command layer such as `/agent`.
- **Edit checkpoint wrapper**: `agent-framework/checkpoints/edit-checkpoint-tools.ts` wraps `Write` and `Edit` at SDK session assembly time. The underlying tool package stays generic; the SDK wrapper snapshots the target file before the first mutation in each prompt turn.
- **Tool result type**: `IToolInvocationResult` in `agent-tools/types/tool-result.ts`

### Sandbox Execution

- **Port owner**: `agent-tools/sandbox/` owns `ISandboxClient`, `ISandboxRunOptions`, and `ISandboxRunResult`.
- **Workspace manifest owner**: `agent-tools/sandbox/` owns `IWorkspaceManifest`, manifest path validation, and generic manifest application. SDK and CLI must not redeclare the manifest shape or implement manifest application algorithms.
- **Adapter owner**: `agent-tools` owns structural sandbox adapters such as `E2BSandboxClient` and `InMemorySandboxClient`. It does not install provider SDKs; application composition roots may install `e2b` or another provider and wrap its sandbox object.
- **SDK assembly**: `createSession()` and `InteractiveSession` accept `sandboxClient?: ISandboxClient`. When present, SDK-created Bash, Read, Write, and Edit tools are created through sandbox-aware factories and route command/filesystem operations through the injected client.
- **Fresh workspace setup**: `InteractiveSession` accepts `workspaceManifest?: IWorkspaceManifest` with `sandboxClient`. The async interactive construction path applies the manifest once before creating the `Session`, using the current project `cwd` as the host root for relative `localFile` and `localDir` sources. The internal synchronous `createSession()` factory does not apply manifests; direct low-level consumers call `applyWorkspaceManifest()` from `agent-tools` before session creation.
- **Snapshot hydration**: If `sessionStore` and a sandbox client with `snapshot()` are provided, `InteractiveSession.shutdown()` captures a provider-owned `sandboxSnapshotId` and stores it in the session record. On non-fork `resumeSessionId`, SDK initialization loads the saved id and calls `sandboxClient.restore(snapshotId)` before constructing the underlying `Session` and before deferred saved-message injection. When a snapshot is restored, fresh `workspaceManifest` application is skipped to avoid overwriting hydrated state.
- **Reversible execution**: If `reversibleExecution.mode` is enabled and no explicit isolation is set, a supplied `sandboxClient` makes the SDK classify Bash and sandbox-routed file mutations as `provider-sandbox` isolated instead of host checkpoint-backed mutations.
- **Boundary**: `agent-cli` and other hosts only decide whether to provide a sandbox client and, if they parse manifest files, convert them into the `agent-tools` manifest contract. They must not implement sandbox command/file/manifest algorithms or provider-specific restore behavior in UI code.

### Edit Checkpointing

- **Package**: `agent-framework/checkpoints/` (SDK-specific session safety layer)
- **Storage**: Project-local `.robota/checkpoints/{session-id}/{turn-id}/manifest.json` plus copied pre-image files under `files/`.
- **Turn model**: Every cwd-backed `InteractiveSession.submit()` prompt starts a turn-level checkpoint. The checkpoint is finalized after the run finishes, even when no file was edited, so prompt turns can be listed consistently. Injected sessions without `cwd` do not implicitly create project checkpoints; they must provide `cwd` or use explicit checkpoint APIs.
- **Capture model**: `Write` and `Edit` tools are wrapped during `createSession()` assembly when an `IEditCheckpointRecorder` is present. A file is captured once per turn before the first tool mutation. Repeated edits to the same file in the same turn reuse the first pre-image.
- **Inspection model**: `inspect(sessionId, checkpointId)` returns captured files, workspace-relative display paths, snapshot availability, and the restore/rollback checkpoint ranges before a caller mutates the workspace.
- **Restore model**: `restoreToCheckpoint(sessionId, checkpointId)` rolls back later checkpoints in reverse sequence order, restores copied pre-images, deletes files that did not exist at capture time, and removes later checkpoint directories. This provides code-only rewind to the selected prompt turn.
- **Boundary**: `agent-tools` does not know about sessions, prompts, `.robota`, or checkpoints. CLI/TUI does not implement checkpoint algorithms; it only exposes SDK command output and future picker UI.
- **Current scope**: `Write` and `Edit` mutations are tracked. Shell-side filesystem changes from `Bash` are not tracked by this layer.

### Reversible Execution Mode

- **Package**: `agent-framework/reversible-execution/` (SDK-specific safety classification and opt-in tool wrapper)
- **Mode**: `createSession({ reversibleExecution: { mode: 'local-first' } })` enables local-first reversible execution enforcement. The mode is opt-in while provider sandbox snapshots are still future work.
- **File mutations**: `Write` and `Edit` are reversible only when an edit checkpoint recorder is present. Without a checkpoint, local-first mode blocks the tool before mutation.
- **Shell/process side effects**: `Bash` and `BackgroundProcess` are not checkpoint-restorable in the parent workspace. Local-first mode requires `worktree` or `provider-sandbox` isolation before allowing those side effects.
- **Agent jobs**: `Agent` jobs are reversible through the worktree layer only when the request or all batch jobs specify `isolation: 'worktree'`, or when the outer execution context is already isolated.
- **Read-only tools**: `Read`, `Glob`, `Grep`, `WebFetch`, and `WebSearch` are classified as read-only and do not require rollback.
- **Boundary**: The policy is SDK-owned and provider-neutral. It does not execute Git commands, manage provider sandboxes, or render UI. Runtime shells and provider adapters supply actual worktree/sandbox isolation.

### Self-Hosting Verification

- **Package**: `agent-framework/self-hosting/` (SDK-specific planning layer)
- **Purpose**: Describes the safe edit/build/verify loop for an agent modifying its own source tree without replacing the currently running process.
- **Planner**: `planSelfHostingVerification()` returns ordered steps for checkpoint creation, atomic file mutation, external process handoff, targeted package verification, an optional repo-wide verification gate, and rollback recovery.
- **State machine**: `transitionSelfHostingLoop()` enforces deterministic lifecycle transitions from `idle` through checkpoint/edit/verify success or failure recovery.
- **Handoff model**: The current process remains the old runtime and keeps already-loaded modules. Verification commands run in child processes against the new on-disk tree.
- **Boundaries**: The SDK planner does not implement file writing, checkpoint storage, CLI rendering, or provider behavior. Atomic write behavior belongs to `agent-tools`; checkpoint storage belongs to `agent-framework/checkpoints`; CLI/TUI only invokes SDK APIs and renders results.
- **No repo-process defaults (NEUT-001)**: `baseRef` and `commandTemplates` (`ISelfHostingCommandTemplates`) are REQUIRED injected config. The library names no package manager, verification command, base ref, or CI gate; per-scope steps come from `commandTemplates.packageVerify` (`{scope}` placeholder) and the optional repo-wide gate from `commandTemplates.repoVerify` (`{baseRef}` placeholder). Robota's own templates live in the unpublished `scripts/harness/self-hosting-verification-commands.mjs`, and the in-package test `src/__tests__/repo-process-neutrality.test.ts` keeps repo-process literals out of the framework source.

### Web Search

- **Local tools**: `WebSearch` and `WebFetch` are ordinary Robota function tools from `@robota-sdk/agent-tools`. They are available to CLI sessions as explicit local tools and are separate from provider-native hosted web features.
- **Provider-native tools**: Anthropic server web search and Qwen Responses web search/fetch are exposed through provider-owned capability reports. Provider capability text must come from the provider adapter or tool descriptor; the system prompt composer must not inject hardcoded web-search behavior instructions.
- **Activation**: Session layers use the provider-neutral `configureNativeWebTools()` hook when a provider chooses to expose automatic hosted web behavior. SDK must not branch on concrete provider names or mutate provider-specific fields directly.
- **Callback**: `onServerToolUse` fires during streaming when a provider-owned server tool executes, allowing the UI to display search status.

### Streaming

- **Implementation**: `TTextDeltaCallback` type (IChatOptions in agent-core)
- **Behavior**: AnthropicProvider uses the streaming API, returning the completed message while calling the callback for each text delta
- **UI connection**: Session → onTextDelta → InteractiveSession `text_delta` event → client

### InteractiveSession (SDK-Specific)

- **Package**: `agent-framework/interactive/`
- **Pattern**: Composition over Session (holds a `Session` instance, does not extend it)
- **Constructor**: Accepts `{ cwd, provider }` plus optional composition inputs such as `commandModules`. Config and context are loaded internally from `cwd`.
- **Responsibility**: Streaming accumulation, tool state tracking, prompt queue (max 1), abort orchestration, full history management (`IHistoryEntry[]`), embedded command execution
- **Tool execution history**: Each `tool_start` and `tool_end` event is recorded as an individual `IHistoryEntry` with `category: 'event'` and `type: 'tool-start'` or `type: 'tool-end'`. Data includes `toolName`, `firstArg`, `isRunning`, and `result`. For completed Edit tools, `IToolState` also carries `diffFile` and `diffLines` derived from the Edit tool arguments plus the tool result `startLine`. For completed command tools, `IToolState` carries `toolResultData` so transports can render bounded command output previews while raw tool messages remain persisted. The `tool-summary` entry (aggregated) is still pushed at execution completion and preserves the same per-tool metadata for persisted UI rendering.
- **Events**: `text_delta`, `tool_start`, `tool_end`, `thinking`, `complete`, `error`, `context_update`, `interrupted`
- **submit() signature**: `submit(input, displayInput?, rawInput?)` — `displayInput` overrides what appears in the client's message list; `rawInput` is passed to `Session.run()` for hook matching
- **Prompt file references**: Before a non-command prompt reaches `Session.run()`, `InteractiveSession` delegates to the SDK-owned prompt file-reference resolver. Path-like tokens such as `@AGENTS.md`, `@./Makefile`, and `@docs/spec.md` are resolved relative to the session `cwd`, constrained to the workspace root, bounded by explicit file/total byte limits, and expanded into model-only prompt context blocks. The user-visible history keeps the original prompt and records a `prompt-file-reference` event with structured records (`sourcePath`, `relativePath`, `originalReference`, `reason`, `depth`, `byteLength`) without storing file contents in the event. Missing, outside-root, directory, circular, max-depth, and size-limit failures are blocking diagnostics and the prompt is not sent to the provider.
- **executeCommand()**: `executeCommand(name, args, source?, originDriverId?)` — executes a named system command via the embedded `SystemCommandExecutor`. Product composition roots inject command modules such as `/compact`; SDK-default user-visible commands are intentionally empty. CMD-004 Phase 2 (Stage B): after a successful command, the SESSION applies its host actions (`src/interactive/interactive-session-host-actions.ts`, generalizing the former hot-swap-only block) via `ICommandHostAdapters` — settings/process/remote-control adapters, direct-on-session rename with a `session_renamed` broadcast — with headless (zero-surface) parity; applied host actions are STRIPPED from the returned result; an absent adapter capability yields an EXPLICIT failure result (no-fallback). The four screen-navigation effects stay dual-carried (legacy effect + a `ui_intent` event stamped with the command-origin driver id, model-invoked fallback = active turn driver) until Stage C; a temporary shim (`src/interactive/command-effect-shim.ts`) maps legacy `TCommandEffect` emissions until Stage E migrates emitters.
- **Edit checkpoints**: `listEditCheckpoints()` returns checkpoint summaries for the active session. `inspectEditCheckpoint(id)` returns captured files and restore/rollback plans. `restoreEditCheckpoint(id)` restores code to a prior checkpoint and records a system history entry. It is rejected while a prompt is running.
- **listCommands()**: `listCommands()` — returns `Array<{ name, description }>` of all registered system commands. Used by transport adapters (e.g., MCP) to expose commands as tools.
- **Queue behavior**: If `executing` is true, the incoming prompt is queued. The queued prompt auto-executes after the current one completes. Only one prompt can be queued at a time.
- **Abort**: `abort()` clears the queue and delegates to `session.abort()`. An `interrupted` event fires when the abort completes.
- **No-op terminal**: Uses a built-in NOOP_TERMINAL so no `ITerminalOutput` implementation is required by callers
- **Session persistence**: When an SDK-owned `sessionStore` facade is provided in options, auto-persists session state (messages, history, cwd, timestamps, system prompt, tool schemas, memory events, used memory references, and provider sandbox snapshot ids when available) after each `submit()` completion and on shutdown. The SDK facade delegates to the concrete `SessionStore` implementation from `agent-session` internally and exposes resumable-session summaries for hosts such as the CLI. Session JSON is the fast snapshot, while append-only JSONL replay logs are the recovery source when the JSON snapshot is missing.
- **Session restore**: When `resumeSessionId` is provided, loads the saved session record and restores AI context. The project session store first reads `.robota/sessions/{id}.json`; if it is missing, it replays `.robota/logs/{id}.jsonl` through `agent-session` replay readers and reconstructs messages/history from `history_mutation` events. For non-fork resumes with `sandboxSnapshotId`, the SDK restores the sandbox before constructing the underlying Session and before injecting messages. Messages are stored as `pendingRestoreMessages` and injected via `session.injectMessage()` after async initialization completes (deferred injection pattern). Memory event history and the last used memory references are restored for `/memory used` and debugging. This avoids injection failures caused by the Session not yet being fully initialized when the constructor runs.
- **forkSession option**: `forkSession?: boolean` (default `false`). When `false` (resume), the original session ID is passed to the Session constructor so it reuses the same file. When `true` (fork), `sessionId` is omitted, generating a fresh UUID — the original session record's content remains untouched (append-only). **Forks restore the conversation too (CLI-073)**: `loadSessionRecord` yields the source messages for deferred injection regardless of fork — fork = fresh UUID + restored context, matching the CLI SPEC's `--fork-session` promise. The only fork/resume difference is the session id.
- **getName()/setName(name)**: Get or set the session's user-facing name. Persists to the session record when a store is configured.
- **attachTransport(transport)**: `attachTransport(transport: ITransportAdapter)` — attaches a transport adapter to this session. Calls `transport.attach(this)`. Used by consumers to compose transports consistently: `session.attachTransport(transport); await transport.start();`
- **Testing**: Accepts an optional pre-built `Session` via `options.session` to enable unit testing without I/O setup

### Command API Layer (SDK-Specific)

- **Package**: `agent-framework/command-api/`
- **Purpose**: Stable SDK-owned API layer consumed by built-in and third-party command modules. It is pure TypeScript, render-agnostic, provider-neutral, and has no CLI/TUI dependency.
- **Contracts**:
  - `ISystemCommand` — command metadata, lifecycle, model/user visibility, and execute function.
  - `ICommandModule` — composition unit contributing command sources, executable commands, descriptors, and session requirements.
  - `ICommandHostContext` — narrow command-facing facade over session/context/runtime capabilities. Command modules must not require `InteractiveSession`, React state, CLI settings files, or TUI hooks directly.
  - `ICommandResult` — command output, structured diagnostics, and typed host effects.
  - `TCommandEffect` — typed host-applied effects such as model/language change, restart, exit, session picker, plugin UI, plugin registry reload, rename, and statusline patch.
  - User-facing prompts are not part of `ICommandResult`. A command that needs input asks for it inline via `context.getUserInteraction()?.ask(IActionRequest)` (CMD-004), the unified action seam owned by `agent-core`.
- **Provider common APIs**: `agent-framework/command-api/provider/` owns provider settings document types, provider profile merge/validation/delete helpers, environment reference helpers, setup-flow primitives including fixed-profile edit defaults, provider-owned setup help link projection, provider profile name suggestion helpers, provider command settings adapter contracts, and provider probe defaults. `provider` command behavior lives in `@robota-sdk/agent-command` and consumes these APIs as an external command module.
- **Org-policy common APIs**: `agent-framework/command-api/org-policy/` owns `IOrgPolicy` (allowedProviders, blockedCommands, requireApiKeyFromEnv, adminContact), `loadOrgPolicy()` (reads `~/.robota/org-policy.json`), `formatOrgPolicyViolationMessage()`, and `isApiKeyPlaintext()`. Enforcement is split: `InteractiveSession.executeCommand()` blocks `blockedCommands` before dispatch and blocks `allowedProviders` violations after a `provider-hot-swap-requested` effect is observed. `IProviderCommandModuleOptions.orgPolicy` passes the policy to provider command module so `buildProviderSwitch` and `completeProviderEdit` can enforce `allowedProviders` and `requireApiKeyFromEnv` within command boundaries. `IAgentRuntimeConfig.orgPolicy` carries the policy through runtime construction to session creation.
- **Context/compact common APIs**: `agent-framework/command-api/context/` owns command-facing context-state reads, automatic compact policy reads, active-session policy updates, settings-adapter persistence helpers, and manual compact host-facade helpers. `context` and `compact` command behavior lives in `@robota-sdk/agent-command` and `@robota-sdk/agent-command`; both consume these APIs as external command modules.
- **Language common APIs**: `agent-framework/command-api/language/` owns language-command metadata constants, recommended subcommands, argument parsing, and usage formatting. `language` command behavior lives in `@robota-sdk/agent-command` and consumes these APIs as an external command module.
- **Memory common APIs**: `agent-framework/command-api/memory/` owns memory-command metadata constants, subcommand projection helpers, project/pending memory store facades, sensitive-content checks, used-memory reference reads, and memory-event recording helpers. `memory` command behavior lives in `@robota-sdk/agent-command` and consumes these APIs as an external command module.
- **Background common APIs**: `agent-framework/command-api/background/` owns background-command metadata constants, subcommand projection helpers, task-list/log formatting helpers, and list/read/cancel/close facades over `ICommandHostContext`. `background` command behavior lives in `@robota-sdk/agent-command` and consumes these APIs as an external command module.
- **Help common APIs**: `agent-framework/command-api/help/` owns help-command metadata constants and generic command-list formatting. `help` command behavior lives in `@robota-sdk/agent-command` and consumes this API as an external command module.
- **Permission common APIs**: `agent-framework/command-api/permissions/` owns permission-mode constants, descriptor subcommands, validation, permission-state reads, permission-state formatting, and command-facing adapter resolution. Canonical permission command behavior lives in `@robota-sdk/agent-command`, which owns `/permissions [mode]`. Legacy `/mode` behavior lives in `@robota-sdk/agent-command` only for applications that explicitly compose that optional module. Both consume these APIs as external command modules.
- **Statusline common APIs**: `agent-framework/command-api/statusline/` owns statusline command metadata constants, subcommand projection helpers, default settings shape, typed settings patch contracts, and patch validation. `statusline` command behavior lives in `@robota-sdk/agent-command` and emits typed host-applied effects instead of importing CLI settings utilities.
- **Plugin common APIs**: `agent-framework/command-api/plugin/` owns plugin command metadata constants, subcommand projection helpers, `ICommandPluginAdapter`, reload result contracts, and plugin host effect factories. `plugin` and `reload-plugins` command behavior lives in `@robota-sdk/agent-command` and consumes these APIs as an external command module while hosts keep concrete plugin storage/UI wiring.
- **Session common APIs**: `agent-framework/command-api/session/` owns command-facing session-history helpers, session-name parsing, session-info reads, and effect factories for host-rendered history/name/picker/exit state. `clear`, `rename`, `resume`, and `cost` command behavior lives in `@robota-sdk/agent-command`; `exit` command behavior lives in `@robota-sdk/agent-command`. Both consume these APIs as external command modules.
- **Settings/process effects**: `agent-framework/command-api/effects.ts` owns the typed `settings-reset-requested` effect. `reset` command behavior lives in `@robota-sdk/agent-command` and emits that effect without importing host settings file I/O.
- **Checkpoint common APIs**: `agent-framework/command-api/checkpoint/` owns command-facing checkpoint metadata constants, subcommand projection helpers, and inspect/list/restore/rollback facades over `ICommandHostContext`. `rewind` command behavior lives in `@robota-sdk/agent-command` and consumes these APIs as an external command module.
- **Boundary**: `command-api` may define contracts and reusable command-facing helpers. It must not own product UI, concrete settings file I/O, process restart/exit, provider construction, or command-specific flows that can live in `agent-command-*` packages.

### Transparent Workflow Contract (SDK-Specific)

The cross-cutting contract lives in
[../../../.agents/specs/transparent-workflow.md](../../../.agents/specs/transparent-workflow.md). The SDK
is the designated owner for reusable transparent workflow contracts and projections:

- any new action provenance types and execution eligibility helpers;
- mapping runtime task states into the shared user-facing state vocabulary;
- execution workspace read models for main-thread, background task, and background group switching;
- any new memory and preference inspection/removal API shapes;
- command-facing facades that let `agent-command-*` expose status and memory controls without
  importing CLI code.

`IExecutionOrigin` is the current task/workspace origin projection. It is not command authorization
provenance by itself. Future transparent workflow implementation PRs must add or extend typed action
provenance before new host command/process execution surfaces depend on it.

User-local preferences, remembered values, and session state may influence display and navigation,
but they must not execute commands. Shell/process/harness command execution must originate from
direct user input or an assistant suggestion accepted through explicit UI approval or the current
user-selected permission policy.

### User-Local Storage Foundation (SDK-Specific)

The cross-cutting storage policy lives in
[../../../.agents/specs/user-local-storage.md](../../../.agents/specs/user-local-storage.md). The SDK
is the designated owner for baseline workflow storage root resolution, repo-outside validation,
category contracts, and item inspection/removal projections.

Existing `projectPaths(cwd)` helpers remain valid for explicit project-owned features such as
project settings, session replay/debug logs, edit checkpoints, and current project memory. New
baseline transparent workflow state must not use `projectPaths(cwd)` or ad hoc `.robota/` paths.
It must use SDK-owned user-local storage contracts.

Existing `userPaths()` helpers expose only current user settings and sessions paths. User-local
workflow state uses the tested `src/user-local/` APIs instead of CLI or command modules assembling
category paths themselves.

### User-Local Memory Transparency (SDK-Specific)

The baseline user-local memory contract lives in
[../../../.agents/specs/user-local-memory.md](../../../.agents/specs/user-local-memory.md). The SDK
is the designated owner for memory item projection shapes, display/navigation disclosure rules,
inspection APIs, delete/disable APIs, and disabled-item non-use.

User-local memory may influence display and navigation only. It must not execute shell/process
commands, select repository harness commands, grant permissions, inject hidden prompt behavior, or
become the execution cwd for a new command by itself.

Existing project memory under `.robota/memory/` remains a separate explicit project-memory feature.
New baseline local preferences, last-view state, and task associations must use the SDK user-local
storage contract instead of project memory paths.

### Transparent Process Execution (SDK-Specific)

The process execution contract lives in
[../../../.agents/specs/process-execution.md](../../../.agents/specs/process-execution.md). The SDK
is the designated owner for process execution request/status projections that sit above runtime
process tasks:

- action provenance attached to user-directed process execution;
- display-safe environment summaries;
- working-directory projection;
- foreground/background process status projection;
- duration and terminal-result projection;
- retention and transcript pointers consumed by command modules, transports, and CLIs.

Existing `BackgroundProcess` and execution workspace APIs are the current building blocks. Future
user-facing process-run commands must use SDK/runtime contracts and must not let CLI components
assemble process semantics from raw child-process state.

### Repository Situational Awareness (SDK-Specific)

Passive repository context display is specified in
[../../../.agents/specs/repository-situational-awareness.md](../../../.agents/specs/repository-situational-awareness.md).
The SDK is the designated owner for context item projections, provenance fields, and bounded read
contracts for cwd, repository root, branch, dirty summary, explicit context references, and active
background workspace context.

Situational awareness projections must not infer commands, package managers, CI mappings,
repository readiness, setup profiles, or harness contracts. Existing context loading may continue to
serve prompt construction, but passive display surfaces must use explicit projection APIs instead of
reusing broad context-loading internals for repository interpretation.

### System Command System (SDK-Specific)

- **Package**: `agent-framework/commands/`
- **Purpose**: SDK command infrastructure and command-facing common APIs — pure TypeScript, no React, no TUI dependency
- **Embedding**: `SystemCommandExecutor` is embedded inside `InteractiveSession`. Consumers normally call `session.executeCommand(name, args)` directly. `SystemCommandExecutor` and `createSystemCommands()` are exported so independent command modules can compose and test against the same command contract.
- **Classes**:
  - `SystemCommandExecutor` — registry + executor for `ISystemCommand` instances (internal to InteractiveSession)
  - `createSystemCommands()` — SDK core executable command factory; currently returns an empty list because user-visible built-ins live in `agent-command-*`
  - `createBuiltinCommandModule()` — SDK core compatibility module; currently empty
- **Design**: Commands return `ICommandResult` with `message`, `success`, and optional SDK-owned `effects`. `data` remains available for command-specific diagnostic payloads, but callers must not invent command-specific side-effect keys. User-facing prompts are solicited inline via the CMD-004 ask seam (`context.getUserInteraction()?.ask`), not returned in the result; host actions such as restart, shutdown, plugin UI, plugin registry reload, session picker, model/language changes, session rename, and status-line updates are represented by typed `TCommandEffect` values.
- **Single owner rule**: SDK-default built-in command metadata is derived from executable `ISystemCommand` records. A built-in command must not be added to autocomplete/help metadata without an executable owner module.
- **Lifecycle policy**: `ISystemCommand` may declare command lifecycle metadata. Blocking foreground commands share the same `InteractiveSession` execution guard and `thinking` events as prompt execution. Inline commands execute immediately and must not call model-backed long-running operations.
- **Command identity**: `ICommand.name`, `ISystemCommand.name`, `ICapabilityDescriptor.name`, and projected model-command reverse mappings use slash-free canonical command ids such as `skills`, `agent`, and `memory`. Slash syntax such as `/skills` or `/agent` belongs only to UI/transport input parsing and display.
- **SDK core built-ins**: SDK core has no user-visible built-in commands. `skills` is owned by `@robota-sdk/agent-command`, which consumes SDK skill discovery and activation APIs like any other command module.
- **Product-specific built-in commands**: User-visible internal commands outside SDK-owned discovery are provided by product-composed command modules.
- **Product-composed built-in command modules**: `skills` is provided by `@robota-sdk/agent-command`. It is user- and model-invocable, lists registered skill metadata, and activates a skill through `ICommandHostContext.executeSkillCommandByName()`. Model-side activation uses the projected `robota_command_skills` tool with skill arguments in `args`.
- **Product-composed built-in command modules**: `help` is provided by `@robota-sdk/agent-command` and renders the composed command list through SDK help common APIs.
- **Product-composed built-in command modules**: `permissions` is provided by `@robota-sdk/agent-command`, reuses SDK permission common APIs for validation/subcommand metadata, state reads/formatting, and permission-mode updates through the command host adapter facade, and stays user-invocable only.
- **Optional legacy command modules**: `mode` is provided by `@robota-sdk/agent-command` only when an application explicitly composes that module. Product CLIs should prefer the canonical `permissions` command for permission-mode changes.
- **Product-composed built-in command modules**: `language` is provided by `@robota-sdk/agent-command`, reuses SDK language command common APIs for usage/subcommand metadata, and emits `language-change-requested` effects for host application.
- **Product-composed built-in command modules**: `statusline` is provided by `@robota-sdk/agent-command`, reuses SDK statusline common APIs for subcommand metadata and typed patch effects, and leaves status bar rendering/settings persistence to the host.
- **Product-composed built-in command modules**: `clear`, `rename`, `resume`, and `cost` are provided by `@robota-sdk/agent-command`. `clear` reuses SDK session command common APIs to clear SDK session history and emits `conversation-history-cleared` so hosts clear rendered history through their own UI state. `rename` reuses SDK session command common APIs to normalize the requested name and emits `session-renamed` so hosts update title/status/persistence through their own adapters. `resume` emits `session-picker-requested` so hosts display saved-session picker UI through their own adapters. `cost` reads session id and message count through SDK session command common APIs.
- **Product-composed built-in command modules**: `reset` is provided by `@robota-sdk/agent-command`. It emits `settings-reset-requested` so hosts apply concrete settings deletion and shutdown at their own adapter/UI boundary.
- **Product-composed built-in command modules**: `rewind` is provided by `@robota-sdk/agent-command`. It reuses SDK checkpoint command common APIs to list prompt-turn checkpoints, inspect captured files and restore plans, restore code to a selected checkpoint, or roll back through a selected checkpoint.
- **Product-composed built-in command modules**: `memory` is provided by `@robota-sdk/agent-command`. It reuses SDK memory command common APIs to inspect project memory, save durable entries, review pending candidates, record memory audit events, and report memory provenance.
- **Product-composed built-in command modules**: `background` is provided by `@robota-sdk/agent-command`. It reuses SDK background command common APIs to list tasks, read logs, cancel queued/running work, and close terminal task records without SDK core embedding command registration.
- **Product-composed built-in command modules**: `context` is provided by `@robota-sdk/agent-command` and reports context window usage plus auto-compact policy through the SDK command host facade. `context auto ...` uses the same common API layer to update the active session immediately and persist through host-provided settings adapters.
- **Product-composed built-in command modules**: `compact` is provided by `@robota-sdk/agent-command`, declares blocking lifecycle metadata through the same `ISystemCommand` contract, and is exposed as a model-invocable `write` capability. Auto-compaction remains a deterministic session policy and emits structured compaction events instead of relying on the model to decide routine compaction.
- **Product-composed built-in command modules**: `exit` is provided by `@robota-sdk/agent-command`. It reuses the SDK session-exit effect helper, stays user-invocable only, and leaves concrete shutdown/process exit to the host effect handler.
- **Product-composed built-in command modules**: `plugin` and `reload-plugins` are provided by `@robota-sdk/agent-command`. They reuse SDK plugin command common APIs, send host UI opening through `plugin-tui-requested`, refresh host plugin command sources through `plugin-registry-reload-requested`, and perform install/uninstall/enable/disable/marketplace/reload operations through a host-provided `ICommandPluginAdapter`.
- **Model-invocable built-ins**: Product-composed command modules such as `skills`, `agent`, `memory`, and `compact` expose descriptors so explicit user/model requests can execute through SDK-projected provider-safe command tools such as `robota_command_skills`. The descriptor owns usage metadata and autonomous-use guidance; the system prompt composer must not add separate behavior instructions.
- **`rewind`**: User-invocable product-composed code checkpoint command. `rewind list` lists prompt-turn checkpoints; `rewind inspect <checkpoint-id>` shows captured files plus restore/rollback ranges; `rewind restore <checkpoint-id>` and `rewind code <checkpoint-id>` restore files to the selected checkpoint. It is not model-invocable by default.
- **Command modules**: Optional `ICommandModule` instances may contribute `ICommandSource` palette metadata, `ISystemCommand` handlers, model-visible descriptors, and session requirements. The SDK does not know command names contributed by modules in advance. Product assemblies can inject host-owned built-ins such as plugin and product-composed command packages such as exit and statusline without adding CLI-specific code to SDK core.

### Slash Command Registry (SDK-Specific)

- **Package**: `agent-framework/commands/` — SSOT owner; agent-cli re-exports from here
- **Classes**:
  - `CommandRegistry` — aggregates multiple `ICommandSource` instances; filters by prefix; resolves plugin-qualified names
  - `BuiltinCommandSource` — SDK core compatibility command source; currently empty
  - `SkillCommandSource` — SDK common API that discovers SKILL.md files from project and user directories; command modules may use it for virtual skill palette metadata
  - `PluginCommandSource` — discovers commands exposed by installed bundle plugins (moved from agent-cli to agent-framework)
- **Migration note**: These classes were previously in `agent-cli/src/commands/`. They were moved to `agent-framework` so any client can use slash command discovery without a TUI dependency. `PluginCommandSource` was also moved from `agent-cli` to `agent-framework` as part of the scope redesign.

### Config Loading (SDK-Specific)

- **Package**: `agent-framework/config/`
- **Rationale**: `.robota/settings.json` file-based configuration is for local development environments only (servers use environment variables/DB)
- **Implementation**: settings file merge, `$ENV:VAR` substitution for provider API keys, Zod validation, provider profile resolution
- **Provider profiles**: settings may define `currentProvider` and `providers`. The active profile is resolved from `providers[currentProvider]`, then normalized into `IResolvedConfig.provider`. Profile identity is the profile key, not the provider type or model pair. Setup helpers suggest readable model-derived keys and append numeric suffixes when the key already exists. Generic provider credentials use `apiKey`; provider-specific advanced authentication belongs in provider-owned `options` or injected clients, not in generic profile fields.
- **Legacy compatibility**: legacy `provider` settings remain supported and are used when no active provider profile is configured.

Provider profile shape:

```json
{
  "currentProvider": "supergemma4-26b-uncensored-v2",
  "providers": {
    "supergemma4-26b-uncensored-v2": {
      "type": "gemma",
      "model": "supergemma4-26b-uncensored-v2",
      "apiKey": "lm-studio",
      "baseURL": "http://localhost:1234/v1"
    },
    "gpt-4o": {
      "type": "openai",
      "model": "gpt-4o",
      "apiKey": "$ENV:OPENAI_API_KEY"
    },
    "qwen3-6-plus": {
      "type": "qwen",
      "model": "qwen3.6-plus",
      "apiKey": "$ENV:DASHSCOPE_API_KEY",
      "options": {
        "builtInWebTools": {
          "webSearch": true,
          "webFetch": true
        }
      }
    }
  }
}
```

Gemma-family local models should be configured through `type: "gemma"` so provider-specific stream projection is applied. DeepSeek API profiles should be configured through `type: "deepseek"` so provider-specific defaults, model catalog metadata, and thinking controls remain provider-owned. `type: "openai"` remains a model-family neutral OpenAI-compatible transport profile.

Provider profile `options` are preserved as provider-owned data. SDK config loading validates that the value is universal/JSON-like and passes it through; SDK code must not interpret provider-specific option keys. OpenAI-compatible local endpoints such as LM Studio should use local `WebSearch`/`WebFetch` function tools for web access unless their concrete provider package documents and enables provider-native hosted web capabilities.

Generated provider profile keys are normalized to lowercase ASCII slugs. The setup flow prefers the selected model id, falls back to provider type, and appends `-2`, `-3`, etc. for duplicates. Secrets, organizations, accounts, and API key fragments must not be included in generated keys.

Provider setup help links come from injected `IProviderDefinition.setupHelpLinks` records. The SDK
formats those provider-owned links for generic prompts, but it does not choose provider URLs or
branch on provider names. Link priority is API key issuance URL, then official console URL, then
official provider documentation or homepage URL.

Resolved provider fields:

| Field     | Description                                                                                         |
| --------- | --------------------------------------------------------------------------------------------------- |
| `name`    | Provider type used by session model config (`anthropic`, `openai`, `gemma`)                         |
| `model`   | Active model id                                                                                     |
| `apiKey`  | API key or local placeholder token                                                                  |
| `baseURL` | Optional OpenAI-compatible endpoint override                                                        |
| `timeout` | Optional provider idle timeout in milliseconds. Also passed to provider construction when supported |
| `options` | Optional provider-owned options bag preserved for CLI/provider composition                          |

### Context Loading (SDK-Specific)

- **Package**: `agent-framework/context/`
- **Rationale**: AGENTS.md/CLAUDE.md walk-up discovery is for local development environments only
- **Implementation**: Directory traversal from cwd to root, project type/language detection, `.robota/memory/MEMORY.md` startup memory loading, active task context loading, system prompt assembly
- **Response Language**: `IResolvedConfig.language` (from settings.json `language` field) is rendered as neutral metadata by `buildSystemPrompt()`. Persists across compaction because system message is preserved.
- **Permission Mode section (CLI-072)**: `buildSystemPrompt()` renders `- **Permission mode:** <mode>` from `ISystemPromptParams.permissionMode` — the ACTIVE `TPermissionMode` resolved exactly as agent-session does (`options.permissionMode ?? TRUST_TO_MODE[config.defaultTrustLevel] ?? 'default'`), so the prompt always names the mode the permission gate enforces. The former `Trust level:` line (a separate axis that defaulted to `moderate` and misled the model under `--permission-mode plan`) is removed; `TRUST_LEVEL_LABELS` is deleted.
- **Compact Instructions**: Extracts "Compact Instructions" section from CLAUDE.md and passes to Session for compaction
- **Skill Discovery Paths**: Skills are discovered from `.agents/skills/*/SKILL.md` (project), `.claude/skills/*/SKILL.md`, `.claude/commands/*.md`, and `~/.robota/skills/*/SKILL.md`. Used by conditional SDK skill metadata injection when `/skills` is model-invocable, and by `@robota-sdk/agent-command` for virtual skill command palette metadata.

### Active Task Context (SDK-Specific)

- **Package**: `agent-framework/context/task-context.ts`
- **Purpose**: Treat active `.agents/tasks/*.md` files as bounded working-memory metadata for the current session.
- **Discovery**: Only direct Markdown files under `.agents/tasks/` are eligible. `README.md` and files under `.agents/tasks/completed/` are excluded.
- **Selection**: Task selection is bounded. Matching `- **Branch**:` metadata for the current git branch takes precedence, followed by `in-progress`, `todo`, then unknown status. Completed tasks are excluded.
- **Formatting**: `formatTaskContext()` renders selected task metadata as neutral Markdown under `Active Task Context`. It includes path, title, status, branch, scope, objective, and unchecked completion items. It must not add behavior instructions.
- **Prompt integration**: `loadContext()` stores formatted task context in `ILoadedContext.taskContext`; `buildSystemPrompt()` renders it after project memory and before runtime metadata. Compaction preserves it because the system message is preserved.
- **Status synchronization**: `updateTaskFileStatus()` updates or inserts the task status metadata and appends a dated progress entry when a progress message is supplied. The function accepts an injected clock for deterministic tests.

### Project Memory (SDK-Specific)

- **Package**: `agent-framework/memory/`
- **Storage**: `.robota/memory/MEMORY.md` is the project memory index; `.robota/memory/topics/*.md` stores topic details.
- **Startup injection**: `loadContext()` reads the memory index into `ILoadedContext.memoryMd`; `buildSystemPrompt()` renders it under the neutral `Project Memory` section. Topic files are not injected at startup.
- **Caps**: Startup memory is capped to the first 200 lines and at most 25KB.
- **Command-driven access**: `memory` is the model-visible project memory interface when the product composes `@robota-sdk/agent-command`. It is exposed through the SDK-projected `robota_command_memory` tool using the injected command descriptor. The descriptor guides the model to inspect memory when stored context may help, add only durable reusable facts, review pending candidates, report provenance, and avoid storing secrets.
- **Sensitive data policy**: Candidate policy must skip obvious secret, token, password, private-key, payment-card, and national-ID style content instead of silently saving it. Additional extractors may be composed later, but they must feed the same policy/store contracts.
- **No hidden turn side effects by default; opt-in post-turn capture (SELFHOST-008 P2)**: `InteractiveSession` never automatically prepends topic memory to user prompts. Post-turn auto-capture is **OFF unless the surface supplies an `automaticMemory?: IAutomaticMemoryConfig`** (adapter-gated — absent ⇒ zero behavior change, no pending candidates created). When supplied, capture runs **once per completed turn**, `await`ed in the execution controller's `finally` **immediately before `persistSession()`** (so recorded `memoryEvents` land in that turn's persisted record) and **try/catch-guarded** (a capture failure is a skip that never breaks the turn — the sanctioned `// allow-fallback:` degradation). It extracts → evaluates → curates through the injected `IMemoryStore`; the default reference policy (`approval_required`) QUEUES candidates (non-destructive), `auto_save` saves above `AUTO_SAVE_CONFIDENCE_THRESHOLD`, and `containsSensitiveMemoryContent` skips secrets before persistence on every path. Explicit `/memory` command writes remain available independently.
- **Reusable retrieval/capture internals**: `MemoryRetrievalService`, `MemoryCandidateExtractor`, `MemoryPolicyEvaluator`, and `PendingMemoryStore` are reusable building blocks. `AutomaticMemoryController` composes them over the neutral `IMemoryStore` port; it is inert until a surface opts in via `automaticMemory` (the capture POLICY stays surface-owned per library neutrality).
- **Deduplication**: `ProjectMemoryStore.append()` returns `deduplicated` and must avoid repeating the same normalized topic entry.
- **Command**: `memory list | show [topic] | add <user|feedback|project|reference> <topic> <text> | pending | approve <id> | reject <id> | used`.
- **Audit trail**: `/memory approve`, `/memory reject`, and future explicit memory workflows append memory events to the session record as `memoryEvents` for resume/debugging. High-frequency streaming data is not part of the memory event stream.
- **Ownership**: SDK owns memory stores, memory policy primitives, and command-facing memory APIs. `@robota-sdk/agent-command` owns command behavior. CLI only composes the module and renders command results/autocomplete metadata.
- **Prompt composition boundary**: The system prompt may include the neutral `Project Memory` startup index and the `/memory` descriptor under `Built-in Commands`; it must not include extra hardcoded memory behavior instructions outside descriptor data.
- **User-local memory boundary**: This project memory feature is not baseline user-local memory.
  User-local display/navigation preferences are governed by
  [../../../.agents/specs/user-local-memory.md](../../../.agents/specs/user-local-memory.md) and
  must not be stored in `.robota/memory/`.

### User-Local Storage

- **Package**: `agent-framework/user-local/`
- **Purpose**: Resolve and inspect baseline workflow storage under user-local storage outside the
  active repository.
- **Default root**: `~/.robota`.
- **Validation**: SDK APIs reject empty roots, relative roots, roots equal to the active repository,
  and roots inside the active repository, including symlink-resolved paths when possible.
- **Categories**: `preferences`, `view-state`, `memory-projections`, `task-associations`,
  `workflow-metadata`, and `inspection-index`.
- **Inspection projection**: SDK returns root, active repository root, category summaries, item
  summaries, storage locations, enabled/delete/disable metadata, and timestamps when available.
- **Command boundary**: `@robota-sdk/agent-command` formats provider-free
  `user-local storage list --format json` output from SDK projections. `agent-cli` only routes the
  direct product command before provider setup and prints the command-owned output.
- **Repository independence**: SDK user-local APIs must not create repository `.robota/` baseline
  workflow state.

### User-Local Memory

- **Package**: `agent-framework/user-local/`
- **Purpose**: Persist explicit display/navigation memory items under the user-local storage root.
- **Storage category**: `memory-projections`.
- **Allowed categories**: `view-preference`, `last-visible-cwd`, `background-selection`,
  `task-association`, `display-preference`, and `inspection-choice`.
- **Projection fields**: category, key, summary, value summary, source, scope, storage location,
  timestamps, enabled state, display/navigation rule, delete/disable availability, and
  `commandExecutionEffect: "none"`.
- **Mutation APIs**: SDK owns set, list, inspect, disable, delete, and enabled-item read behavior.
- **Disabled-item rule**: disabled items remain inspectable but `readEnabledUserLocalMemoryItem`
  returns `null`, so they cannot affect display/navigation defaults.
- **Command boundary**: `@robota-sdk/agent-command` formats provider-free
  `user-local memory ...` output from SDK projections. `agent-cli` only routes the product command
  and passes terminal options such as `--summary`, `--source`, and `--format`.
- **Repository independence**: user-local memory APIs must not write baseline memory inside the
  active repository or project `.robota/`.

### Context Window Management

- **Token tracking**: `agent-session` Session tracks cumulative input tokens from provider response metadata
- **Usage state**: `session.getContextState()` returns `IContextWindowState` (usedTokens, maxTokens, usedPercentage)
- **Auto-compaction**: Triggers at the configured context-window threshold, defaults to ~83.5%, and can be disabled per session
- **Manual compaction**: `session.compact(instructions?)` generates LLM summary, replaces history
- **Model sizes**: Lookup table per model (200K for Sonnet/Haiku, 1M for Opus)
- **Compact Instructions**: Extracted from CLAUDE.md "Compact Instructions" section, passed to summary prompt
- **Hooks**: PreCompact/PostCompact events in agent-core, fired before/after compaction
- **Callbacks**: `onCompact` in `createQuery()` options for notification when compaction occurs

## Public API

### InteractiveSession — Central Client-Facing API

Wraps `Session` (composition) to provide event-driven interaction for any client (CLI, web, API server, worker). Manages streaming text accumulation, tool execution state tracking, prompt queuing, abort orchestration, and message history. Logic previously embedded in CLI React hooks.

The SDK is pure TypeScript with no React dependency. The CLI is a thin TUI-only layer that subscribes to `InteractiveSession` events and maps them to React/Ink state.

```typescript
import { InteractiveSession } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

// Consumer creates provider and passes it to InteractiveSession.
// Config and context are loaded internally from cwd.
const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });
const session = new InteractiveSession({ cwd: process.cwd(), provider });

// Event-driven — subscribe to state changes
session.on('text_delta', (delta: string) => { /* streaming text chunk */ });
session.on('tool_start', (state: IToolState) => { /* tool execution began */ });
session.on('tool_end', (state: IToolState) => { /* tool execution finished */ });
session.on('thinking', (isThinking: boolean) => { /* execution state changed */ });
session.on('complete', (result: IExecutionResult) => { /* prompt completed */ });
session.on('error', (error: Error) => { /* execution error */ });
session.on('context_update', (state: IContextWindowState) => { /* token usage updated */ });
session.on('interrupted', (result: IExecutionResult) => { /* abort completed */ });
session.on('skill_activation', (event: ISkillActivationEvent) => { /* skill activation state */ });
session.on('memory_event', (event: IMemoryEvent) => {
  /* memory capture/approval/retrieval; user-visible types are also appended to history as
     category 'event' / type 'memory-event' entries with a formatMemoryEventMessage() message */
});

// Submit prompt. Queues if already executing (max 1 queued).
// displayInput: shown in UI (e.g., "/audit") instead of full built prompt
// rawInput: passed to Session.run() for hook matching
await session.submit(input, displayInput?, rawInput?);

// Execute a named system command. Virtual `/skill-name` entries are normalized by the SDK
// command registry into the composed `skills` command with `<skill-name> [args]`.
const result = await session.executeCommand('context', '');
// result.message — human-readable string
// result.success — boolean
// result.data   — command-specific structured data

// List all registered system commands (for transport adapters)
const commands = session.listCommands(); // Array<{ name, description }>

// Abort current execution and clear queue
session.abort();

// Cancel queued prompt without aborting current execution
session.cancelQueue();

// Graceful shutdown: reject new prompts, abort foreground work, cancel managed background tasks,
// persist final session state, and fire SessionEnd through agent-session.
await session.shutdown({ reason: 'prompt_input_exit', message: 'User requested exit' });

// State queries
session.isExecuting();       // boolean
session.getPendingPrompt();  // string | null
session.getMessages();       // TUniversalMessage[] — backward-compatible; returns chat entries only
session.getFullHistory();    // IHistoryEntry[] — full history including event entries (tool summaries, skill invocations)
session.getContextState();   // IContextWindowState
session.getStreamingText();  // string (accumulated so far)
session.getActiveTools();    // IToolState[]
```

### Self-Hosting Verification Planner

The SDK exports pure planning/state helpers for clients that need to drive a safe edit/build/verify loop without coupling to CLI or TUI rendering.

```typescript
import {
  planSelfHostingVerification,
  transitionSelfHostingLoop,
} from '@robota-sdk/agent-framework';

// NEUT-001: baseRef and commandTemplates are REQUIRED injected config — the library
// ships no repo-specific defaults. Robota's own values live in the unpublished
// `scripts/harness/self-hosting-verification-commands.mjs`.
const plan = planSelfHostingVerification({
  changedFiles: ['packages/agent-framework/src/index.ts'],
  packageScopes: ['@robota-sdk/agent-framework'],
  baseRef: 'origin/main',
  commandTemplates: {
    packageVerify: [{ name: 'test', template: 'npm run test --workspace {scope}' }],
    repoVerify: { description: 'Repo-wide gate.', template: 'npm run verify -- {baseRef}' },
  },
});

let state = transitionSelfHostingLoop('idle', 'checkpoint_created');
state = transitionSelfHostingLoop(state, 'edits_started');
state = transitionSelfHostingLoop(state, 'edits_applied');
state = transitionSelfHostingLoop(state, 'verify_passed');
```

`plan.steps` is an ordered, provider-neutral command plan. Consumers execute commands in child processes and keep the current SDK process alive as the old runtime. The planner does not write files, restore checkpoints, or render UI.

### Task Context Helpers

The SDK exports pure helpers for discovering, selecting, formatting, and updating active task files.

```typescript
import { loadTaskContext, updateTaskFileStatus } from '@robota-sdk/agent-framework';

const taskContext = loadTaskContext(process.cwd(), {
  currentBranch: 'feat/context-injection-task-files',
  maxTasks: 3,
});

updateTaskFileStatus('.agents/tasks/CLI-BL-017-context-injection-from-task-files.md', 'completed', {
  progressMessage: 'Verified task context injection.',
});
```

These helpers operate on Markdown files under `.agents/tasks/`. They do not render UI and do not inject behavior instructions into the prompt; the formatted task context is neutral metadata.

**IToolState:**

```typescript
interface IToolState {
  toolName: string;
  firstArg: string;
  isRunning: boolean;
  result?: 'success' | 'error' | 'denied';
  diffLines?: IDiffLine[];
  diffFile?: string;
  toolResultData?: string;
}
```

`diffLines` is structured Edit tool display metadata. For completed Edit tools, `InteractiveSession` derives it from the Edit arguments, tool result `startLine`, and the modified file contents when readable. Diff lines may include `type: 'hunk'`, `context`, `remove`, and `add`. `toolResultData` is the already-truncated tool result payload emitted by the permission/session layer; transports may derive bounded previews from it, but SDK/session records remain the source for full transcript recovery. The SDK persists this metadata so all transports can replay the same tool summary; CLI owns visual rendering only.

**IExecutionResult:**

```typescript
interface IExecutionResult {
  response: string;
  history: IHistoryEntry[]; // Full history including chat + event entries
  toolSummaries: IToolSummary[];
  contextState: IContextWindowState;
  usage?: IUsageSnapshot;
}
```

`IUsageSnapshot` is the SDK-owned provider-neutral execution usage record:

```typescript
interface IUsageSnapshot {
  kind: 'exact' | 'estimated';
  scope: 'turn';
  totalTokens: number;
  promptTokens?: number;
  completionTokens?: number;
  contextUsedTokens: number;
  contextMaxTokens: number;
  contextUsedPercentage: number;
  costStatus: 'unknown' | 'estimated' | 'exact';
}
```

`InteractiveSession` appends a `usage-summary` event entry after the assistant response when exact provider usage is available. The entry is persisted in `IHistoryEntry[]` so `/resume`, headless transports, and debugging can display usage without reparsing assistant prose.

**IInteractiveSessionEvents:**

```typescript
interface IInteractiveSessionEvents {
  text_delta: (delta: string) => void;
  tool_start: (state: IToolState) => void;
  tool_end: (state: IToolState) => void;
  thinking: (isThinking: boolean) => void;
  complete: (result: IExecutionResult) => void;
  error: (error: Error) => void;
  context_update: (state: IContextWindowState) => void;
  compact: (event: ICompactEvent) => void;
  interrupted: (result: IExecutionResult) => void;
  skill_activation: (event: ISkillActivationEvent) => void;
  background_task_event: (event: TBackgroundTaskEvent) => void;
  background_job_group_event: (event: TBackgroundJobGroupEvent) => void;
  execution_workspace_event: (event: IExecutionWorkspaceEvent) => void;
  user_message: (content: string) => void;
  context_file_refreshed: (event: IContextFileRefreshedEvent) => void;
  memory_event: (event: IMemoryEvent) => void; // all automatic-memory pipeline events
}
```

`ICompactEvent` is owned by `agent-session` and imported from `@robota-sdk/agent-session`. All other event payload types are owned by `agent-framework`.

**ITransportAdapter:**

`ITransportAdapter` is owned by `@robota-sdk/agent-interface-transport` and re-exported from `@robota-sdk/agent-framework`. Each `agent-transport-*` package provides a factory that returns an `ITransportAdapter` implementation.

```typescript
interface ITransportAdapter<TSession = unknown> {
  /** Human-readable transport name (e.g., 'http', 'ws', 'mcp', 'headless') */
  readonly name: string;

  /** Attach a session to this transport. */
  attach(session: TSession): void;

  /** Start serving. */
  start(): Promise<void>;

  /** Stop serving and clean up resources. */
  stop(): Promise<void>;
}
```

### Background and Subagent Runtime Exports

`BackgroundTaskManager` is re-exported from `agent-executor` as the generic runtime registry for long-running work. It owns task IDs, queueing, bounded concurrency, lifecycle events, targeted cancellation, shutdown, terminal close/dismiss, optional send/log controls, watchdogs, and immutable state snapshots.

Runner adapters receive `IBackgroundTaskStart.emit(event)` for progress reporting. The manager stamps task IDs onto runner events, updates `currentAction` for tool start/end events, and forwards the resulting `TBackgroundTaskEvent` to subscribers.

Background task runtime exports (from `src/background-tasks/index.ts`):

Note: `BackgroundTaskManager`, `BackgroundTaskError`, `createLimitedOutputCapture`, `appendPrefixedLogLines`, `createBackgroundTaskLogPage`, and `transitionBackgroundTaskStatus` are owned by `agent-executor` and are NOT re-exported as values from `@robota-sdk/agent-framework`. Consumers that need these runtime classes directly must import from `@robota-sdk/agent-executor`. The framework only re-exports their type interfaces and the SDK-owned orchestration layer.

| Export                                  | Kind      | Description                                                             |
| --------------------------------------- | --------- | ----------------------------------------------------------------------- |
| `BackgroundJobOrchestrator`             | class     | SDK-owned grouping/wait layer above `BackgroundTaskManager`             |
| `summarizeBackgroundJobGroup`           | function  | SDK helper: returns counts and concise result lines for a group         |
| `createExecutionWorkspaceSnapshot`      | function  | SDK-owned main-thread/task/group workspace projection                   |
| `createExecutionWorkspaceTaskSpawner`   | function  | Origin-bound task spawning port for commands, skills, and transports    |
| `createLineDetailPage`                  | function  | Build a cursor-based detail page for a task log line stream             |
| `createMainThreadDetailPage`            | function  | Build a detail page for the main thread transcript                      |
| `createBackgroundGroupExecutionEntryId` | function  | Generate a stable ID for a background group workspace entry             |
| `createBackgroundTaskExecutionEntryId`  | function  | Generate a stable ID for a background task workspace entry              |
| `createExecutionOriginMetadata`         | function  | Build opaque origin metadata for task provenance                        |
| `createMainThreadExecutionEntryId`      | function  | Generate a stable ID for the main thread workspace entry                |
| `parseExecutionWorkspaceEntryId`        | function  | Parse a workspace entry ID into its components                          |
| `EXECUTION_ORIGIN_METADATA_KEYS`        | const     | Canonical keys for execution origin metadata bag                        |
| `IBackgroundTaskManager`                | interface | Generic manager API for spawn/wait/list/get/cancel/close/shutdown/send  |
| `IBackgroundTaskRunner`                 | interface | Port implemented by agent/process runner adapters                       |
| `ILimitedOutputCapture`                 | interface | Runtime-owned bounded output capture contract                           |
| `TBackgroundTaskIdFactory`              | type      | Request-aware task ID factory used by composed managers                 |
| `IBackgroundTaskState`                  | interface | Runtime lifecycle state for one background task                         |
| `TBackgroundTaskRequest`                | type      | Discriminated union of agent/process background task requests           |
| `IBackgroundTaskResult`                 | interface | Completed background task output                                        |
| `TBackgroundTaskEvent`                  | type      | Runtime-owned lifecycle/progress event union                            |
| `TBackgroundTaskRunnerEvent`            | type      | Runner-owned progress event union without task IDs                      |
| `TBackgroundTaskMode`                   | type      | `foreground` or `background`                                            |
| `TBackgroundTaskStatus`                 | type      | Shared task lifecycle status union                                      |
| `TBackgroundTaskTimeoutReason`          | type      | Watchdog reason union projected onto failed task state                  |
| `IBackgroundJobGroupState`              | interface | Parent-session-scoped background task group snapshot                    |
| `IBackgroundJobGroupSummary`            | interface | Presentation-neutral group completion counts and result lines           |
| `TBackgroundJobWaitPolicy`              | type      | `detached`, `wait_all`, `wait_any`, or `manual` group completion policy |
| `IExecutionWorkspaceEntry`              | interface | Presentation-neutral selectable execution entry                         |
| `IExecutionWorkspaceSnapshot`           | interface | Session-scoped execution workspace read model                           |
| `IExecutionWorkspaceTaskSpawner`        | interface | SDK task creation port for agent/process tasks and groups               |
| `IExecutionOrigin`                      | interface | SDK-owned task provenance projected from opaque runtime metadata        |

Background agent watchdog configuration is provider-neutral. Agent requests may set `idleTimeoutMs`, `maxRuntimeMs`, `outputLimitBytes`, `maxTextDeltas`, `repetitionWindow`, and `repetitionThreshold`; the runtime refreshes `lastActivityAt` from runner progress events and fails runaway jobs with `timeoutReason`.

`InteractiveSession` subscribes to background task events, persists every event including streaming text deltas into the session record for local debugging/resume, and emits `background_task_event` for transports and TUI state projection. It also maps background agent lifecycle events into Claude Code-compatible `SubagentStart` and `SubagentStop` hooks.

`BackgroundJobOrchestrator` is the SDK-owned layer above `BackgroundTaskManager` for parent-request orchestration. It groups related task IDs, applies a wait policy, emits group lifecycle events, and produces result envelopes with task IDs, labels, terminal status, concise output summaries, output references, and errors. It also exposes presentation-neutral summary helpers for command/transport/UI adapters. The orchestrator does not run processes, own provider calls, mutate TUI state, or inject hardcoded prompt instructions.

`InteractiveSession` exposes background job group controls:

| API                                  | Behavior                                                       |
| ------------------------------------ | -------------------------------------------------------------- |
| `createBackgroundJobGroup(request)`  | Create a parent-session-scoped group over existing task IDs    |
| `listBackgroundJobGroups()`          | Return cloned group snapshots                                  |
| `getBackgroundJobGroup(groupId)`     | Return one cloned group snapshot                               |
| `waitBackgroundJobGroup(groupId)`    | Resolve when the group's wait policy reaches a terminal result |
| `summarizeBackgroundJobGroup(group)` | Return counts and concise result lines for an existing group   |

`InteractiveSession` emits `background_job_group_event` with `TBackgroundJobGroupEvent`. When session persistence is enabled, group snapshots and group events are stored alongside background task snapshots/events so resume/debugging can reconstruct group provenance.

`SubagentManager` and `WorktreeSubagentRunner` are owned by `agent-executor` and are NOT exported as values from `@robota-sdk/agent-framework`. Consumers needing these classes must import from `@robota-sdk/agent-executor`. The framework exports only the SDK-owned `createInProcessSubagentRunner` factory plus type-only re-exports of the subagent contracts.

```typescript
import { createInProcessSubagentRunner } from '@robota-sdk/agent-framework';
import type { ISubagentRunner, ISubagentSpawnRequest } from '@robota-sdk/agent-framework';
// For the SubagentManager class itself, import from agent-executor:
import { SubagentManager } from '@robota-sdk/agent-executor';
```

Agent subagent requests may set `isolation: 'worktree'`. The SDK treats this as a contract flag and propagates it through `agent` command arguments, `ISubagentSpawnRequest`, and background task metadata. Worktree isolation is explicit unless a host assembly provides and documents a capability-aware default policy; SDK core must not silently infer or fallback between isolated and non-isolated execution. `agent-executor` owns `WorktreeSubagentRunner`, which decorates any `ISubagentRunner` with worktree lifecycle, metadata, cleanup, and hook behavior. Runtime shells provide an `ISubagentWorktreeAdapter` implementation for concrete local Git/filesystem operations. If a preserved worktree is returned by a runner, `IBackgroundTaskResult.metadata.worktreePath`, `branchName`, `worktreeStatus`, `worktreeNextAction`, `worktreeBaseRevision`, and `parentWorktreeStatus` are projected onto matching `IBackgroundTaskState` fields.

`createBackgroundProcessTool(deps)` is exported for SDK composition. The tool is registered only when a runtime shell injects a `process` background runner through `createSession({ backgroundTaskRunners })`; default `Bash` foreground behavior remains unchanged.

`createSession()` also accepts `subagentRunnerFactory?: TSubagentRunnerFactory`. When omitted, SDK composition uses `createInProcessSubagentRunner`. Runtime shells such as `agent-cli` may inject a factory that receives the same assembled dependency bundle and returns a process-backed `ISubagentRunner`.

Exported subagent types from `src/subagents/index.ts`:

| Export                            | Kind      | Description                                                               |
| --------------------------------- | --------- | ------------------------------------------------------------------------- |
| `createInProcessSubagentRunner`   | function  | Runner adapter that executes subagent jobs with `createSubagentSession()` |
| `IInProcessSubagentRunnerDeps`    | interface | Dependencies captured by the in-process runner adapter                    |
| `TSubagentRunnerFactory`          | type      | Factory seam for runtime shells to replace the default subagent runner    |
| `ISubagentManager`                | interface | Type re-export from `agent-executor`; manager API                         |
| `ISubagentManagerOptions`         | interface | Type re-export from `agent-executor`; manager construction options        |
| `ISubagentRunner`                 | interface | Type re-export from `agent-executor`; single-job runner port              |
| `ISubagentWorktreeAdapter`        | interface | Type re-export from `agent-executor`; concrete worktree I/O port          |
| `ISubagentWorktreePrepareRequest` | interface | Type re-export from `agent-executor`; worktree prepare request            |
| `IWorktreeSubagentRunnerOptions`  | interface | Type re-export from `agent-executor`; worktree runner options             |
| `IPreparedSubagentWorktree`       | interface | Type re-export from `agent-executor`; prepared worktree handoff           |
| `ISubagentJobHandle`              | interface | Type re-export from `agent-executor`; targeted job handle                 |
| `ISubagentJobState`               | interface | Type re-export from `agent-executor`; subagent job projection             |
| `ISubagentJobStart`               | interface | Type re-export from `agent-executor`; job start request                   |
| `ISubagentSpawnRequest`           | interface | Type re-export from `agent-executor`; spawn request                       |
| `ISubagentJobResult`              | interface | Type re-export from `agent-executor`; completion output and metadata      |
| `TSubagentJobMode`                | type      | Type re-export from `agent-executor`; `foreground` or `background`        |
| `TSubagentJobStatus`              | type      | Type re-export from `agent-executor`; lifecycle status union              |

### History Entry Types

`InteractiveSession` manages history as `IHistoryEntry[]`. Each entry has a `category` field:

| Category  | Description                                                                                 |
| --------- | ------------------------------------------------------------------------------------------- |
| `'chat'`  | A standard conversation message (`TUniversalMessage`). Returned by `getMessages()` as-is.   |
| `'event'` | A structured non-message event (tool summary, skill invocation, system notification, etc.). |

**Tool summary entry** (appended by `InteractiveSession` after each execution round):

```typescript
// category: 'event', type: 'tool-summary'
{
  id: string;
  timestamp: Date;
  category: 'event';
  type: 'tool-summary';
  data: {
    summary: string;
    tools: Array<{
      toolName: string;
      firstArg: string;
      isRunning: boolean;
      result?: 'success' | 'error' | 'denied';
      diffLines?: IDiffLine[];
      diffFile?: string;
      toolResultData?: string;
    }>;
  }
}
```

**Usage summary entry** (appended by `InteractiveSession` after each completed turn when usage exists):

```typescript
{
  category: 'event',
  type: 'usage-summary',
  data: {
    kind: 'exact',
    scope: 'turn',
    promptTokens: 1000,
    completionTokens: 200,
    totalTokens: 1200,
    contextUsedTokens: 1200,
    contextMaxTokens: 200000,
    contextUsedPercentage: 0.6,
    costStatus: 'unknown',
  }
}
```

**Skill activation entry** (appended by `InteractiveSession` when a real skill activation starts):

```typescript
// category: 'event', type: 'skill-activation'
{
  id: string;
  timestamp: Date;
  category: 'event';
  type: 'skill-activation';
  data: {
    skillName: string;
    source: 'skill' | 'plugin';
    invocation: 'user-slash' | 'model-tool';
    mode: 'inject' | 'fork';
    status: 'started' | 'completed' | 'failed';
    message: string;
    qualifiedName?: string;
    error?: string;
  }
}
```

Legacy `skill-invocation` entries may still be rendered when resuming older sessions, but new SDK
execution records use `skill-activation`.

Consumers that need only AI messages call `getMessages()` (returns `TUniversalMessage[]` — backward-compatible). Consumers that need the full picture (e.g., rendering a rich message list) call `getFullHistory()` (returns `IHistoryEntry[]`).

### System Commands — Embedded in InteractiveSession

`SystemCommandExecutor` is embedded inside `InteractiveSession`. Consumers access system commands via `session.executeCommand(name, args)`. Command module packages may import `ISystemCommand`, `ICommandModule`, `SystemCommandExecutor`, and `createSystemCommands()` for composition tests.

The command types and result interface are exported for consumers that need to inspect results:

```typescript
import type { ICommandResult, ISystemCommand } from '@robota-sdk/agent-framework';

// Execute a named command on the session (returns null if command not found)
const result: ICommandResult | null = await session.executeCommand('context', '');
// result.message — human-readable string
// result.success — boolean
// result.data   — command-specific structured data
```

**Product-composed command modules:**

| Command              | Description                                                                  |
| -------------------- | ---------------------------------------------------------------------------- |
| `help`               | Command module for rendering registered commands                             |
| `clear`              | Optional command module for clearing conversation and rendered host history  |
| `compact`            | Compress context window (optional focus instructions)                        |
| `language`           | Request response language update through `language-change-requested` effect  |
| `cost`               | Optional session command module for session ID and message count             |
| `context`            | Token usage: used / max / percentage                                         |
| `permissions [mode]` | Current mode, session-approved tools, and permission mode changes            |
| `statusline`         | Optional command module for statusline visibility and git branch patch flows |
| `memory`             | List/show/add/review project memory and report used memory references        |
| `rewind`             | List edit checkpoints, restore later edits, or rollback through a checkpoint |
| `reset`              | Requests settings reset through `settings-reset-requested` effect            |
| `resume`             | Optional command module for requesting session picker through effect         |
| `rename`             | Optional command module for requesting session rename through effect         |
| `provider`           | Optional command module for provider current/list/use/add/test flows         |

**ISystemCommand:**

```typescript
interface ISystemCommand {
  name: string;
  description: string;
  modelInvocable?: boolean;
  userInvocable?: boolean;
  argumentHint?: string;
  safety?: TCapabilitySafety;
  subcommands?: readonly ICommand[];
  lifecycle?: 'inline' | 'blocking' | 'background';
  execute(context: ICommandHostContext, args: string): Promise<ICommandResult> | ICommandResult;
}
```

`ICommandHostContext` is the command-facing facade supplied by the SDK executor. Command implementations must depend on the specific context methods or typed host adapters they need rather than accepting `InteractiveSession`, CLI state, or UI hooks.

`ICommandHostAdapters` is the host-provided adapter bag exposed through `ICommandHostContext.getCommandHostAdapters()`. It currently includes settings persistence, process lifecycle, permission-mode access, and plugin-management adapters. Command modules may request only the adapter they need; they must not import a concrete CLI/TUI implementation.

**ICommandModule:**

```typescript
interface ICommandModule {
  name: string;
  commandSources?: readonly ICommandSource[];
  systemCommands?: readonly ISystemCommand[];
  commandDescriptors?: readonly ICapabilityDescriptor[];
  sessionRequirements?: readonly TCommandModuleSessionRequirement[];
}
```

`sessionRequirements` is how command modules request optional SDK wiring. The current requirement is `agent-executor`, which enables agent definitions and the shared background/subagent managers for command-owned agent execution.

**ICommandResult:**

```typescript
interface ICommandResult {
  message: string;
  success: boolean;
  data?: Record<string, TCommandResultDataValue>;
  effects?: readonly TCommandEffect[];
}

type TCommandEffect =
  | { type: 'provider-hot-swap-requested'; profileName: string }
  | { type: 'language-change-requested'; language: string }
  | { type: 'settings-reset-requested' }
  | { type: 'session-exit-requested'; reason?: TSessionEndReason; message?: string }
  | { type: 'session-restart-requested'; reason: TSessionEndReason; message: string }
  | { type: 'plugin-tui-requested' }
  | { type: 'plugin-registry-reload-requested' }
  | { type: 'settings-tui-requested' }
  | { type: 'session-picker-requested' }
  | { type: 'session-renamed'; name: string }
  | { type: 'conversation-history-cleared' }
  | { type: 'session-execution-started' }
  | { type: 'statusline-settings-patch'; patch: TStatusLineCommandSettingsPatch }
  | { type: 'agent-switcher-requested' };
```

A command that needs user input does not return a continuation in `ICommandResult`. It asks inline via the CMD-004 unified seam — `context.getUserInteraction()?.ask(IActionRequest)` — which is owned by `agent-core`, reaches both command and tool execution, and is rendered per-environment by the active channel's `askUser`. See the Interaction Channel Contract section.

### CommandRegistry, BuiltinCommandSource, SkillCommandSource, PluginCommandSource

Command discovery and aggregation for clients that expose a slash command palette or autocomplete UI. Owned by `agent-framework`; agent-cli re-exports `CommandRegistry` from here. `PluginCommandSource` was moved from `agent-cli` to `agent-framework` so all clients benefit from plugin command discovery. Command modules can be added through `registry.addModule(module)` without the registry knowing their command names. Hosts can call `registry.replaceSource(name, source)` to refresh dynamic sources such as plugin-provided commands after a successful reload effect.

```typescript
import {
  CommandRegistry,
  SkillCommandSource,
  PluginCommandSource,
} from '@robota-sdk/agent-framework';

const registry = new CommandRegistry();
registry.addModule(commandModule);
registry.addSource(new SkillCommandSource(process.cwd()));

registry.getCommands(); // ICommand[] — all composed commands and virtual entries
registry.getCommands('mod'); // filtered by prefix (for autocomplete)
registry.resolveQualifiedName('audit'); // "my-plugin:audit" or null
registry.getSubcommands('mode'); // ICommand[] — subcommands
```

`BuiltinCommandSource` remains exported as an empty SDK-core compatibility source. Product command entries come from composed `ICommandModule` values such as `@robota-sdk/agent-command`.

`SkillCommandSource` scans (highest priority first):

1. `<cwd>/.claude/skills/*/SKILL.md`
2. `<cwd>/.claude/commands/*.md` (Claude Code compatible)
3. `~/.robota/skills/*/SKILL.md`
4. `<cwd>/.agents/skills/*/SKILL.md`

### createQuery() — Convenience Factory

`createQuery({ provider })` is a factory that returns a prompt-only function. The caller creates the provider; the factory captures it and returns a simple async function that accepts a prompt string.

```typescript
import { createQuery } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const provider = new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY });
const query = createQuery({ provider });

const response = await query('Show me the file list');

const queryWithOptions = createQuery({
  provider,
  cwd: '/path/to/project',
  permissionMode: 'acceptEdits',
  maxTurns: 10,
  onTextDelta: (delta) => process.stdout.write(delta),
});

const detailedResponse = await queryWithOptions('Analyze the code');
```

`createSession()` is an **internal** assembly factory — it is not exported from `@robota-sdk/agent-framework`. Config and context loading, tool assembly, and provider wiring happen inside `InteractiveSession` and `createQuery()`.

### Session — Direct Usage (Generic)

```typescript
import { Session } from '@robota-sdk/agent-session';

// Session requires pre-constructed tools, provider, and systemMessage
const session = new Session({ tools, provider, systemMessage, terminal });
const response = await session.run('Hello');
```

### Public Surface Ownership

The top-level `@robota-sdk/agent-framework` entrypoint exposes SDK-owned APIs and explicit SDK facades.
It must not pass through general-purpose `agent-core`, `agent-session`, or `agent-tools` exports
only for convenience. See [PUBLIC-SURFACE.md](PUBLIC-SURFACE.md) for the export classification.

Allowed public classes:

- SDK-owned APIs: `InteractiveSession`, `createQuery`, command contracts/common APIs, project
  memory, checkpoints, reversible execution, plugin management, and task context helpers.
- SDK facades: project session store helpers, subagent assembly helpers, agent/background process
  tools, and command host/common APIs that narrow lower-level behavior through SDK contracts.
- Explicit runtime facades: background-task and subagent lifecycle contracts re-exported through
  `src/background-tasks/index.ts` and `src/subagents/index.ts`.

Owner-direct APIs:

- `agent-core` owns history helpers, provider interfaces, permissions, hooks, context window types,
  and generic message utilities.
- `agent-tools` owns direct built-in tool exports and tool result types.
- `agent-session` owns generic session APIs and terminal output primitives.

`pnpm harness:scan:sdk-public-surface` prevents broad `export *` barrels, top-level lower-owner
pass-through exports, and runtime re-exports outside the documented SDK facade barrels.

### History Types — Owner Package

```typescript
import {
  IHistoryEntry,
  isChatEntry,
  chatEntryToMessage,
  messageToHistoryEntry,
  getMessagesForAPI,
} from '@robota-sdk/agent-core';
```

| Export                  | Kind      | Description                                                                           |
| ----------------------- | --------- | ------------------------------------------------------------------------------------- |
| `IHistoryEntry`         | interface | Rich history entry: `id`, `timestamp`, `category` ('chat' \| 'event'), `type`, `data` |
| `isChatEntry`           | function  | Type guard that narrows `IHistoryEntry` to chat entries                               |
| `chatEntryToMessage`    | function  | Converts a chat `IHistoryEntry` to `TUniversalMessage`                                |
| `messageToHistoryEntry` | function  | Converts a `TUniversalMessage` to a chat `IHistoryEntry`                              |
| `getMessagesForAPI`     | function  | Extracts `TUniversalMessage[]` from `IHistoryEntry[]` (filters to chat entries only)  |

### Built-in Tools — Direct Usage

`@robota-sdk/agent-framework` assembles built-in tools internally for SDK sessions. Direct tool usage
imports from `@robota-sdk/agent-tools`:

```typescript
import {
  bashTool,
  editTool,
  globTool,
  grepTool,
  readTool,
  webFetchTool,
  webSearchTool,
  writeTool,
} from '@robota-sdk/agent-tools';
```

### Permissions — Direct Usage

```typescript
import { evaluatePermission } from '@robota-sdk/agent-core';
```

`promptForApproval` is exported from `agent-framework` for CLI and transport adapters that implement a non-TUI permission flow:

| Export              | Kind     | Description                                                                                  |
| ------------------- | -------- | -------------------------------------------------------------------------------------------- |
| `promptForApproval` | function | Prompts the user for allow/deny approval before a tool runs using `ITerminalOutput.select()` |

### Skill Prompt Utilities

`substituteVariables` and `preprocessShellCommands` are pure helpers for skill prompt processing:

| Export                    | Kind     | Description                                                                        |
| ------------------------- | -------- | ---------------------------------------------------------------------------------- |
| `substituteVariables`     | function | Substitutes `$VAR` / `${VAR}` placeholders in a skill prompt string from a context |
| `preprocessShellCommands` | function | Extracts shell commands embedded in skill prompt text for pre-execution            |
| `ISkillPromptContext`     | type     | Variable substitution context shape for `substituteVariables`                      |

### Path Helpers

`projectPaths` and `userPaths` are SDK-owned path helpers for project-local and user-local file resolution:

| Export         | Kind     | Description                                                                         |
| -------------- | -------- | ----------------------------------------------------------------------------------- |
| `projectPaths` | function | Returns structured project-local paths under `.robota/` for a given `cwd`           |
| `userPaths`    | function | Returns structured user-local paths under `~/.robota/` (settings, sessions, memory) |

These helpers are used by SDK assembly and command modules. Transparent workflow baseline storage must not use `projectPaths(cwd)` or ad hoc `.robota/` paths — use the user-local storage root resolver instead.

## Import Rules

These rules define which packages each layer is allowed to import from. Violations break the layered architecture.

### CLI (`agent-cli`)

| Source             | Allowed                       | Notes                                                                     |
| ------------------ | ----------------------------- | ------------------------------------------------------------------------- |
| `agent-framework`  | All SDK-owned public APIs     | InteractiveSession, createQuery, runtime contracts re-exported by SDK     |
| `agent-executor`   | ❌ Direct import discouraged  | CLI should receive runtime ports through SDK composition/re-exports       |
| `agent-core`       | Public types + utilities only | TUniversalMessage, TPermissionMode, createSystemMessage, getModelName     |
| `agent-core`       | ❌ Internal engine classes    | Robota, ExecutionService, ConversationStore are forbidden                 |
| `agent-session`    | ❌ Forbidden                  | SDK provides its own session types; CLI must not import sessions directly |
| `agent-tools`      | ❌ Forbidden                  | SDK assembles tools internally                                            |
| `agent-provider-*` | Provider creation only        | AnthropicProvider, GeminiProvider (CLI picks which to use)                |

### SDK (`agent-framework`)

| Source             | Allowed      | Notes                                                 |
| ------------------ | ------------ | ----------------------------------------------------- |
| `agent-core`       | Full access  |                                                       |
| `agent-executor`   | Full access  | Background task/subagent lifecycle primitives         |
| `agent-session`    | Full access  |                                                       |
| `agent-tools`      | Full access  |                                                       |
| `agent-provider-*` | ❌ Forbidden | SDK is provider-neutral; provider comes from consumer |

### Transport packages (`agent-transport-*`)

| Source            | Allowed                                    | Notes |
| ----------------- | ------------------------------------------ | ----- |
| `agent-framework` | InteractiveSession and related types       |       |
| `agent-core`      | Public types only (TUniversalMessage etc.) |       |

## Design Decision Records

### Claude Code vs Claude Agent SDK Relationship (Research)

- Claude Agent SDK extracts the Claude Code runtime (running the CLI as a subprocess)
- Robota adopts a direct code sharing approach rather than subprocess
- Layer hierarchy: agent-cli → agent-framework → agent-session → agent-core (upper layers import lower layers)
- Research document: `docs/superpowers/research/2026-03-19-claude-code-vs-agent-sdk.md`

### General/Specialized Separation Criteria

Each module's placement is determined by "Is this used only in the SDK, or is it general-purpose?":

| Module                 | Verdict                            | Rationale                                                                                                            |
| ---------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Permissions            | **General** → agent-core           | Tool permission checks are needed on servers too                                                                     |
| Hooks                  | **General** → agent-core           | Audit/validation is needed on servers too                                                                            |
| Built-in tools         | **General** → agent-tools          | File system tools are needed in playground/server environments too                                                   |
| Session                | **General** → agent-session        | Session management is needed in any environment                                                                      |
| Config loading         | **SDK-specific** → agent-framework | `.robota/settings.json` is for local environments only                                                               |
| Context loading        | **SDK-specific** → agent-framework | AGENTS.md walk-up is for local environments only                                                                     |
| Agent runtime deps     | **SDK-specific** → agent-framework | Sub-session creation dependencies are assembled by SDK and consumed through command/runtime APIs                     |
| InteractiveSession     | **SDK-specific** → agent-framework | Client-facing event wrapper; no CLI/React dependency; reusable by all clients                                        |
| SystemCommandExecutor  | **SDK-specific** → agent-framework | Embedded in InteractiveSession; accessed via session.executeCommand(); exported for command module composition tests |
| CommandRegistry et al. | **SDK-specific** → agent-framework | Slash command discovery is useful for any client; moved from CLI to SDK                                              |
| ITerminalOutput        | **General** → agent-session        | Terminal I/O abstraction (SSOT in permission-enforcer.ts; agent-cli has a duplicate)                                 |

### Existing Package Refactoring History

- **agent-session**: Removed existing SessionManager/ChatInstance (zero consumers, no-op persistence), replaced with Session/SessionStore from agent-framework
- **agent-tools**: Added 8 built-in tools in `builtins/` directory (Bash, Read, Write, Edit, Glob, Grep, WebFetch, WebSearch), added `IToolInvocationResult` type
- **agent-core**: Added `permissions/` and `hooks/` directories
- **agent-provider (`./anthropic` sub-path)**: Multi-block content handling (text + tool_use), streaming `chatWithStreaming`, `onTextDelta` support

## Hook Type Executors (SDK-Specific)

agent-framework provides two additional `IHookTypeExecutor` implementations that extend the hook system beyond agent-core's built-in `command` and `http` executors:

| Executor         | Hook Type | Description                                                                                        |
| ---------------- | --------- | -------------------------------------------------------------------------------------------------- |
| `PromptExecutor` | `prompt`  | Injects the hook's prompt text into the session context as a system-level instruction              |
| `AgentExecutor`  | `agent`   | Creates a nested agent session (via `createSession`) to process the hook input and return a result |

These executors are registered with `runHooks` via the `executors` map during session creation in `createSession()`.

## Settings Configuration

Settings are loaded with a 6-file precedence model (lowest priority first). `.robota/` is the primary configuration convention; `.claude/` paths are supported for Claude Code compatibility.

| Layer | Path                          | Scope                                   |
| ----- | ----------------------------- | --------------------------------------- |
| 1     | `~/.robota/settings.json`     | User global                             |
| 2     | `~/.claude/settings.json`     | User global (Claude Code compatible)    |
| 3     | `.robota/settings.json`       | Project                                 |
| 4     | `.robota/settings.local.json` | Project (local)                         |
| 5     | `.claude/settings.json`       | Project (Claude Code compatible)        |
| 6     | `.claude/settings.local.json` | Project (local, Claude Code compatible) |

The `.claude/settings.json` layers provide Claude Code compatibility — settings written by Claude Code are automatically picked up by Robota. Higher layers override lower layers via deep merge. `$ENV:VAR` substitution is applied after merge for provider API keys.

Provider resolution order:

1. `currentProvider` plus `providers[currentProvider]`
2. Legacy `provider`
3. Existing defaults

Provider profile schema:

| Field     | Description                                                                     |
| --------- | ------------------------------------------------------------------------------- |
| `type`    | Provider implementation type such as `anthropic` or `openai`                    |
| `model`   | Default model ID for the profile                                                |
| `apiKey`  | Literal key or `$ENV:<name>` reference                                          |
| `baseURL` | Optional OpenAI-compatible or provider-specific endpoint                        |
| `timeout` | Optional provider idle timeout and provider construction timeout when supported |

`currentProvider` must point to an existing profile key. Missing profiles and profiles without `type` are configuration errors. Profile keys are stable user-facing identifiers; two profiles may have the same `type` and `model` when they represent different credentials, accounts, endpoints, or operational defaults. Legacy `provider` remains accepted for backward compatibility, but it must not override an explicit active provider profile.

The SDK remains provider-neutral: it resolves provider metadata for session assembly, but consumers such as `agent-cli` still construct concrete provider instances. During session assembly, `config.provider.timeout` is forwarded to `Session.providerTimeout`; when omitted, SDK assembly uses a 120-second provider idle timeout so headless/TUI sessions cannot wait forever for a stalled provider call.

## Bundle Plugin System

Bundle plugins package reusable extensions (tools, hooks, permissions, system prompt additions) into installable units.

### Types

| Type                    | Description                                                     |
| ----------------------- | --------------------------------------------------------------- |
| `IBundlePluginManifest` | Plugin metadata: name, version, description, author, keywords   |
| `ILoadedBundlePlugin`   | Full bundle: manifest + tools, hooks, permissions, systemPrompt |

### Loader

`BundlePluginLoader` loads a bundle plugin from a directory path. It reads the manifest, resolves tool/hook definitions, and validates the bundle structure.

### Installer

`BundlePluginInstaller` manages plugin installation and uninstallation:

- Installs bundles to `~/.robota/plugins/` (user) or `.robota/plugins/` (project)
- Tracks installed plugins in a registry file
- Handles enable/disable state per plugin

## Marketplace Client

`MarketplaceClient` provides plugin discovery and installation from remote sources.

- **Source management**: Add, remove, and list marketplace sources
- **Default marketplace**: Built-in default source URL for the Robota plugin marketplace
- **Search**: Query available plugins by name, keyword, or category
- **Install**: Download and install plugins via `BundlePluginInstaller`

## System Prompt Skill and Agent Injection

Skills discovered from skill directories are exposed to the system prompt by metadata only when the
session has a composed model-invocable `skills` command descriptor. The metadata includes name and
description only. The `## Skills` section owns model-visible skill selection metadata and must not
include extra hardcoded behavior instructions. `skills` is owned by
`@robota-sdk/agent-command` as a normal built-in command module. Full `SKILL.md` content is
loaded only when the composed `skills` command calls SDK skill activation through
`ICommandHostContext.executeSkillCommandByName()`. Skills with `disable-model-invocation: true` are
omitted from model-visible metadata and rejected for model-sourced `skills` activation.

When at least one model-invocable command exists, `createSession()` projects each descriptor into a
provider-safe tool named `robota_command_<command>`. The projection layer keeps a reverse map from
provider-visible tool name to slash-free command id, validates collisions before session assembly,
and routes execution through the same `ISystemCommand` handler used by user-entered slash commands.
`skills` uses the projected `robota_command_skills` route with `args: "<skill-name> [args]"`.
`createSession()` must not register `ExecuteSkill` or any parallel direct skill model tool. A model
mentioning or recommending a skill in ordinary prose is not a skill activation.

For user prompts, `InteractiveSession.submit()` does not parse natural language for skill names or
activation phrases. Natural-language skill selection belongs to the model-facing `skills`
descriptor and the projected `robota_command_skills` tool route. Explicit slash input such as
`/audit src/index.ts` is a virtual command alias normalized by `executeCommand()` into the composed
`skills` command with args `audit src/index.ts`.

Projected command tool names must match provider naming constraints (`^[A-Za-z0-9_-]{1,64}$`) and
use the `robota_command_` namespace. Their provider-visible descriptions come from registered
command descriptors so command owners, not the system prompt composer, own autonomous-use guidance.
`createSession()` must not register projected command tools when no registered command descriptor is
model-invocable. The legacy `createCommandExecutionTool()` helper remains exported for compatibility,
but `createSession()` does not expose both routes for the same command behavior.

Selection must not be implemented with local keyword matching, alias tables, or natural-language
pre-routing inside `InteractiveSession`.

Agent definitions are exposed to the system prompt by metadata only when an injected command module requests `agent-executor`. Without that session requirement, agent runtime dependencies, agent definitions, and model-visible agent metadata are omitted.

Agent execution is routed through command/runtime APIs such as `agent` and through `context: fork` skill execution. `createSession()` stores reusable agent runtime dependencies for those paths but does not register a separate model-visible `Agent` tool.

### Skill Execution Semantics

`InteractiveSession.executeCommand(name, args)` is the only transport-facing slash execution path.
When `name` is a virtual skill name and a `skills` command module is composed, the SDK normalizes the
request to command `skills` with args `<skill-name> [args]`. TUI and headless transports must not call skill-specific
execution methods.

`InteractiveSession.executeSkillCommandByName(name, args, request)` is the SDK host API consumed by
the `skills` command module. It resolves the named skill from SDK-owned skill sources, validates the
invocation source, loads the full `SKILL.md`, emits `skill_activation`, and returns structured command
results/effects. Model-sourced calls return processed skill instructions as command result data;
user-sourced calls submit the rendered prompt or fork execution into the active session and emit
`session-execution-started`.

| Skill metadata             | Behavior                                                                                              |
| -------------------------- | ----------------------------------------------------------------------------------------------------- |
| no `context`               | Render skill content and submit it into the current session                                           |
| `context: fork`            | Run rendered skill content in an isolated subagent session using `skill.agent` or `general-purpose`   |
| `allowed-tools`            | Restrict fork-session tools to the listed names, after the selected agent definition denylist applies |
| `disable-model-invocation` | Hide from model-visible skill metadata; user slash invocation still works                             |
| `user-invocable: false`    | Hide from user slash menus; model metadata remains available unless model invocation is disabled      |

Fork skill execution must not rely on prompting the parent model to call the `Agent` tool. It must call `createSubagentSession()` directly through the per-session agent tool dependencies so the behavior is deterministic and unit-testable.

Every activation records an `ISkillActivationEvent`:

```typescript
interface ISkillActivationEvent {
  readonly type: 'skill-activation';
  readonly skillName: string;
  readonly source: 'skill' | 'plugin';
  readonly invocation: 'user-slash' | 'model-tool';
  readonly mode: 'inject' | 'fork';
  readonly status: 'started' | 'completed' | 'failed';
  readonly timestamp: string;
  readonly qualifiedName?: string;
  readonly error?: string;
}
```

`InteractiveSession` stores skill activation events in `skillActivationEvents` when session
persistence is enabled. The event list is restored with the session record and the started event is
also represented in `IHistoryEntry[]` for UI rendering. Consumers must not report a skill as active
unless this event exists.

## Hook Wiring into Session Lifecycle

During `createSession()`, hooks from the merged settings configuration are wired into the session lifecycle:

1. Hook configuration is extracted from the resolved config
2. SDK-specific executors (`PromptExecutor`, `AgentExecutor`) are registered alongside core executors
3. `SessionStart` hooks fire during session initialization
4. `PreToolUse`/`PostToolUse` hooks are invoked by `PermissionEnforcer` around tool execution
5. `UserPromptSubmit` hooks fire before each user message is processed
6. `Stop` hooks fire on session termination

## Background Task Execution

`BackgroundTaskManager` is owned by `agent-executor` and re-exported by `agent-framework` through the explicit runtime facade. It is the generic lifecycle layer for foreground/background agent and process jobs. It is provider-neutral and depends only on injected runner ports.

Responsibilities:

- create addressable background task records
- enforce bounded concurrency across registered task kinds
- track lifecycle state: `queued`, `running`, `waiting_permission`, `completed`, `failed`, `cancelled`
- expose `spawn`, `wait`, `list`, `get`, `cancel`, `close`, `send`, `readLog`, and `subscribe`
- emit a single `TBackgroundTaskEvent` union for lifecycle/progress projection
- keep runner implementation details out of TUI, transports, and tool code

The manager does not create providers, sessions, child processes, worktrees, or TUI state directly. Those concerns belong to runner adapters and outer composition layers. SDK code composes the manager with SDK-owned tools and `InteractiveSession`; it does not own the lifecycle state machine.

SDK runtime facade barrels also re-export runtime-owned helper primitives for bounded output
capture and cursor-based log pagination so runtime shells can implement process adapters through
the documented SDK facade instead of importing `agent-executor` directly.

### Agent Wake Dedup & Eviction (FLOW-002 / CORE-024)

`InteractiveSession.requestWakeup(instruction, sourceTaskId)` injects an agent-driven turn and
tracks `sourceTaskId` in a live set so a background task cannot enqueue overlapping wakes for the
same source. That tracking set must be cleaned up on **every** exit path, not only on a wake that
runs to a completed turn:

- The id is removed when its wake turn completes (the normal path).
- It is **also** removed when the wake is evicted before completing — session `abort()`,
  `shutdown()`, or a pending-queue drop. Otherwise the `sourceTaskId` lingers in the set and every
  future wake for that task is silently rejected forever (RUNTIME-19). Clearing the pending queue
  clears the corresponding wake-tracking ids.

`InteractiveSession` exposes background task controls:

| Method                         | Behavior                                      |
| ------------------------------ | --------------------------------------------- |
| `listBackgroundTasks(filter?)` | Return cloned background task state snapshots |
| `getBackgroundTask(taskId)`    | Return one cloned task snapshot               |
| `cancelBackgroundTask(...)`    | Targeted task cancellation                    |
| `closeBackgroundTask(taskId)`  | Remove a terminal task from the registry      |
| `sendBackgroundTask(...)`      | Forward optional input to a supporting runner |
| `readBackgroundTaskLog(...)`   | Read optional runner logs                     |

`InteractiveSession` emits `background_task_event` with `TBackgroundTaskEvent`.

`InteractiveSession` also exposes an SDK-owned execution workspace read model for clients that need
to switch between the main conversation, background tasks, and background groups without owning
lifecycle state:

| Method                                     | Behavior                                                                |
| ------------------------------------------ | ----------------------------------------------------------------------- |
| `getExecutionWorkspaceSnapshot()`          | Return a presentation-neutral snapshot with the main-thread entry first |
| `listExecutionWorkspaceEntries(filter?)`   | Return selectable main-thread/task/group entries                        |
| `getExecutionWorkspaceEntry(entryId)`      | Return one execution workspace entry                                    |
| `readExecutionWorkspaceDetail(...)`        | Return a normalized detail page for main transcript, task log, or group |
| `createExecutionWorkspaceTaskSpawner(...)` | Return an origin-bound SDK task spawning port for commands/skills/hosts |

The read model is the only shared contract for task-switching surfaces. `agent-cli` and transports
may render entries, keep ephemeral selection state, and invoke explicit controls, but they must not
infer lifecycle, retention, origin, unread/attention semantics, or control availability from raw
events when this projection is available.

The cross-client background work state contract is defined in
[../../../.agents/specs/background-work-state.md](../../../.agents/specs/background-work-state.md).
The current `IExecutionWorkspaceEntry` shape covers stable ids, entry kind, origin, status, labels,
preview, current action, attention, visibility, updated time, and advisory controls. Future fields
such as started time, elapsed time, input-needed reason, terminal result, retention state, archive,
and clear controls must be added to the SDK projection before CLI or transport surfaces render them.

Execution workspace entries use a common `IExecutionWorkspaceEntry` shape:

- `main_thread` is an SDK projection backed by `InteractiveSession` history and current foreground
  execution state. It is not a `BackgroundTaskManager` record.
- `background_task` entries are projections of `IBackgroundTaskState`.
- `background_group` entries are projections of `BackgroundJobOrchestrator` groups.
- `origin` is SDK-owned provenance. Runtime stores only opaque primitive metadata; the SDK maps it
  into `IExecutionOrigin` for commands, model commands, tool calls, skills, transports, and system
  work. This is presentation provenance; command execution eligibility for transparent workflow
  features must follow the action provenance contract.
- `controls` is presentation-neutral and advisory. Selecting an entry is never a lifecycle
  mutation; cancellation, close, send, read, wait, and group summary remain explicit APIs.

Default visibility keeps active, permission-blocked, failed, cancelled, and unread-completed tasks
in the workspace list. Clean completed tasks remain queryable through runtime state until `close()`
or session cleanup, but clients may choose a collapsed recent/history presentation from the SDK
entry metadata instead of deleting records.

The workspace state vocabulary follows the transparent workflow contract. Current runtime
`waiting_permission` snapshots must be projected for clients as user-facing `waiting-for-input`
state when the surface is not exposing raw runtime types for debugging.

When session persistence is enabled, `InteractiveSession` must persist background task state as part of the project-local session record. Lifecycle, tool start/end, permission, completion, failure, cancellation, and close events update the session JSON with the latest task snapshots and durable event summaries. High-frequency `background_task_text_delta` events must not rewrite the main session JSON per chunk; they are written to append-only JSONL session logs and task/subagent transcript files so debugging data is available while streaming is still in progress without risking partial JSON writes.

`createSession()` accepts `backgroundTaskRunners?: IBackgroundTaskRunner[]`. When a runner with `kind: 'process'` is present, SDK composition registers the model-callable `BackgroundProcess` tool:

- `BackgroundProcess` starts a command as `kind: 'process'`, `mode: 'background'`
- it returns `{ success, background: true, output: '', taskId, status, command }` immediately
- stdout/stderr inspection and cancellation are routed through the shared manager APIs
- existing `Bash` tool behavior is not changed

`createSession()` accepts `subagentRunnerFactory?: TSubagentRunnerFactory`. The SDK default remains `createInProcessSubagentRunner(agentToolDeps)`. A runtime shell may supply a factory to run `agent` command jobs through a process-backed runner while reusing the same config/context/tool dependency bundle assembled by the SDK.

Runner progress semantics:

- `background_task_text_delta` forwards partial output for preview surfaces
- `background_task_tool_start` sets `IBackgroundTaskState.currentAction`
- `background_task_tool_end` clears `currentAction` on success or stores the error/action on failure
- progress events do not complete, fail, cancel, or close tasks; lifecycle remains manager-owned
- progress and lifecycle events are diagnostic data, not just UI state; SDK composition must route them to session logging/persistence when those facilities are configured

The product-composed `/background` command module maps to these APIs:

| Command                               | Behavior                       |
| ------------------------------------- | ------------------------------ |
| `/background` or `/background list`   | List current background tasks  |
| `/background read <task-id> [offset]` | Read a task log page           |
| `/background cancel <task-id>`        | Cancel one running/queued task |
| `/background close <task-id>`         | Dismiss one terminal task      |

## Subagent Execution

### SubagentManager

`SubagentManager` is owned by `agent-executor` and re-exported by `agent-framework` through the explicit runtime facade. It is the managed subagent facade. It depends on an injected `ISubagentRunner` port or an injected `IBackgroundTaskManager` and maps subagent jobs to `BackgroundTaskManager` agent tasks.

Responsibilities:

- create addressable subagent job records
- enforce bounded concurrency
- track lifecycle state: `queued`, `running`, `waiting_permission`, `completed`, `failed`, `cancelled`
- expose `spawn`, `wait`, `list`, `get`, `cancel`, `close`, and `send` operations
- keep runner implementation details out of TUI and command-module code

`SubagentManager` does not create providers, sessions, child processes, worktrees, or TUI state directly. Those concerns belong to runner adapters and outer composition layers. It exposes `getBackgroundTaskManager()` so SDK `InteractiveSession` can forward generic background task events and controls without depending on subagent-specific types.

### SubagentRunner Port

`ISubagentRunner` is owned by `agent-executor` and is the execution boundary for one subagent job. Implementations can run jobs in-process for tests or in a child process for CLI runtime.

```typescript
interface ISubagentRunner {
  start(job: ISubagentJobStart): ISubagentJobHandle;
}

interface ISubagentJobStart {
  jobId: string;
  request: ISubagentSpawnRequest;
  emit?: (event: TBackgroundTaskRunnerEvent) => void;
}

interface ISubagentJobHandle {
  readonly jobId: string;
  readonly pid?: number;
  readonly logPath?: string;
  readonly transcriptPath?: string;
  result: Promise<ISubagentJobResult>;
  cancel(reason?: string): Promise<void>;
  send?(prompt: string): Promise<void>;
  readLog?(cursor?: IBackgroundTaskLogCursor): Promise<IBackgroundTaskLogPage>;
}
```

The runner reports completion through its `result` promise and supports targeted cancellation through `cancel()`. Follow-up routing via `send()` is optional until a runner supports it. Log reading via `readLog()` is optional, but process-backed subagent runners should implement it so `/agent read AGENT_ID` can inspect append-only transcripts while a job is still running.

`createInProcessSubagentRunner(deps)` is the default SDK adapter for foreground compatibility. It resolves the requested agent definition, creates an isolated child `Session` with `createSubagentSession()`, runs the prompt, and maps the response to `ISubagentJobResult`.

### WorktreeSubagentRunner

`WorktreeSubagentRunner` is owned by `agent-executor`. It keeps worktree isolation behavior reusable across CLI, headless, or future runtime shells while keeping concrete Git commands outside the reusable runtime layer.

The decorator depends on:

- an inner `ISubagentRunner` that performs the actual agent execution
- an `ISubagentWorktreeAdapter` port that can prepare, inspect, and remove worktrees
- optional `THooksConfig` and hook executors for worktree lifecycle notifications

When `job.request.isolation !== 'worktree'`, the decorator delegates to the inner runner without changing the request.

When `job.request.isolation === 'worktree'`, the decorator must:

- call `ISubagentWorktreeAdapter.prepare({ jobId, cwd })`
- invoke the inner runner with `cwd`, `worktreePath`, and `branchName` set to the prepared worktree
- emit `WorktreeCreate` hook notification after preparation
- remove clean worktrees exactly once on success, delegated failure, synchronous delegated start failure, or successful cancellation
- preserve dirty worktrees and return `worktreePath`, `branchName`, `worktreeStatus`, and `worktreeNextAction` in `ISubagentJobResult.metadata`
- include adapter-provided `baseRevision` and dirty parent checkout status in handoff metadata when available
- preserve existing result metadata while adding worktree metadata
- emit `WorktreeRemove` hook notification when a clean worktree is removed

### createSubagentSession(options)

Assembles an isolated child Session for subagent execution. Unlike `createSession`, this factory does not load config files or context from disk — it receives pre-resolved config and context from the parent session.

**Tool filtering order:**

1. Remove disallowed tools (denylist from agent definition)
2. Keep only allowed tools (allowlist from agent definition, if specified)
3. Always remove agent-spawning tools such as `Agent` and `robota_command_agent` (subagents cannot spawn subagents)

**Model resolution:** Agent definition model override (with shortcut expansion: `sonnet`, `haiku`, `opus`) takes priority; falls back to parent config model.

### Agent Definitions

`IAgentDefinition` interface defines the shape for both built-in and custom agents:

| Field             | Type       | Required | Description                                     |
| ----------------- | ---------- | -------- | ----------------------------------------------- |
| `name`            | `string`   | Yes      | Unique agent identifier                         |
| `description`     | `string`   | Yes      | Human-readable purpose description              |
| `systemPrompt`    | `string`   | Yes      | Markdown body used as the agent's system prompt |
| `model`           | `string`   | No       | Model override (inherits parent when omitted)   |
| `maxTurns`        | `number`   | No       | Maximum agentic turns                           |
| `tools`           | `string[]` | No       | Allowlist of tool names                         |
| `disallowedTools` | `string[]` | No       | Denylist of tool names                          |

**Built-in agents:**

| Name              | Model Override | Tool Restrictions   | Purpose                     |
| ----------------- | -------------- | ------------------- | --------------------------- |
| `general-purpose` | (parent)       | None (inherits all) | Full-capability task agent  |
| `Explore`         | (parent)       | Denies Write, Edit  | Read-only code exploration  |
| `Plan`            | (parent)       | Denies Write, Edit  | Read-only planning/research |

### Model-Requested Agent Invocation

Model-requested agent invocation is owned by `@robota-sdk/agent-command`. The command module
contributes `agent` as a model-invocable built-in command and requests the SDK `agent-executor`
session requirement. The model route is the same projected command-tool path used by other
built-ins: `robota_command_agent({ args: "..." })`.

The SDK stores agent runtime dependencies for the command module and for `context: fork` skills.
It does not register a separate model-visible `Agent` function tool. Parallel, batch, detached, and
worktree agent behavior belongs to `agent` command arguments and the shared runtime job APIs.

Structured command/background-task results are the only evidence that agent work started or
completed. Assistant prose is not execution evidence.

When `isolation: 'worktree'` is requested, a runtime shell that supports worktree isolation must compose `WorktreeSubagentRunner` with a concrete `ISubagentWorktreeAdapter`. The runtime runner handles lifecycle, cleanup, handoff metadata, and `WorktreeCreate` / `WorktreeRemove` hook notifications; the shell adapter handles Git/filesystem I/O. Unsupported non-Git or shell states must fail with actionable messages unless the user explicitly requested non-isolated execution.

### AgentDefinitionLoader (Internal)

`AgentDefinitionLoader` is an internal class — it is not exported from `src/index.ts`. It scans directories for custom `.md` agent definitions with YAML frontmatter, merged with built-in agents. Custom agents override built-in agents on name collision.

**Scan directories (highest priority first):**

1. `<cwd>/.robota/agents/` — project-level (Robota native)
2. `<cwd>/.agents/agents/` — project-level (Robota repository convention)
3. `<cwd>/.claude/agents/` — project-level (Claude Code compatible)
4. `<home>/.robota/agents/` — user-level (Robota native)
5. `<home>/.claude/agents/` — user-level (Claude Code compatible)

### Framework System Prompt Suffixes

Two suffix modes appended to subagent system prompts:

- **Subagent suffix** (default): Instructs the agent to report concisely to the caller
- **Fork worker suffix** (`isForkWorker: true`): Instructs the agent to respond within 500 words, suitable for skill fork execution

### assembleSubagentPrompt(options)

Assembles the full system prompt for a subagent session:

1. Agent body (from agent definition `systemPrompt`)
2. CLAUDE.md content (from parent context)
3. AGENTS.md content (from parent context)
4. Framework suffix (subagent or fork worker)

### Subagent Transcript Logger

`createSubagentLogger(parentSessionId, agentId, baseLogsDir)` creates a `FileSessionLogger` for append-only subagent transcripts. Subagent sessions must run with `sessionId = agentId`, so the transcript is written to `{baseLogsDir}/{parentSessionId}/subagents/{agentId}.jsonl`.

Subagent transcript logs must include session initialization, prompts, tool calls/results, streaming `text_delta` chunks, final assistant output, context state, and errors. Parent sessions may store only transcript paths and task snapshots in `.robota/sessions/*.json`; the transcript JSONL remains the source of truth for high-frequency streaming data.

## Autonomous Goal Pursuit (GOAL-001)

A user-assigned high-level objective that the agent pursues autonomously across multiple turns until it is satisfied or a bound fires. The capability is owned by `agent-framework`; surfaces (the `/goal` slash command and the `--goal` headless flag) delegate to it. Naming is vendor-neutral throughout.

### Contract types (SSOT)

`IGoalState`, `IGoalEvent`, `IGoalProgressEntry`, `TGoalStatus`, and `TGoalStopReason` are defined in `@robota-sdk/agent-interface-transport` (the persistence/transport SSOT) and re-exported through the session contracts. `IGoalState` is persisted in `IInteractiveSessionRecord.goal` so an in-flight goal survives `--resume`.

### Completion signal (deterministic, not heuristic)

While a goal is active the agent reports its assessment by calling the built-in `report_goal_status({ status: 'continue' | 'satisfied', reason })` tool (`GOAL_SIGNAL_TOOL_NAME`). The tool is schema-validated and stateless; the loop reads the LAST such call from the completed turn's `toolSummaries` via `extractGoalSignal`. There is no prose/keyword parsing — a missing or malformed signal is treated as "no signal", never as satisfaction. The tool is included in every interactive session (`includeGoalTool: true`) and is inert when no goal is active.

### Controller and loop

`GoalController` (`src/goal/`) is pure decision logic (no IO), unit-tested in isolation. `onTurnComplete(result)` advances the goal and returns either `{ action: 'continue', prompt }` or `{ action: 'stop', reason }`. `InteractiveSession` drives the loop: `setGoal(objective, options)` seeds the goal and schedules the first agent-driven turn through the FLOW-002 `requestWakeup` primitive (tagged `agent-wakeup`); each completed agent-driven turn advances the controller and either schedules the next wakeup or stops. `getGoalState()` and `cancelGoal()` expose state and cancellation.

`PlanController` (`src/plan/`, SELFHOST-002) mirrors this design for explicit plan-mode: pure decision logic (no IO), unit-tested in isolation. It owns the plan phase machine (`planning`→`awaiting-approval`→`executing`→`completed`) over the plan/todo artifact (`IPlanArtifact`, owned by `agent-interface-transport` beside `IGoalState`). `approve()` returns `{ action: 'approve', nextMode: 'acceptEdits' }`, `revert()`/`complete()` return `{ action: 'revert', nextMode: 'plan' }` — the controller NEVER calls `setPermissionMode` itself; `InteractiveSession` applies each `nextMode`, exactly as it applies `GoalController` decisions. The mutation block stays the existing `plan` permission mode (single enforcement point via `PermissionEnforcer`/`evaluatePermission`) — no second gate. Per `MODE_POLICY.acceptEdits`, an approved plan auto-applies `Write`/`Edit` while `Bash`/`Shell` stay per-call confirmed.

### Stop conditions (all mandatory)

- `satisfied` — the agent signalled completion.
- `max-iterations` — the per-goal turn budget (`maxIterations`, default `DEFAULT_GOAL_MAX_ITERATIONS = 25`) was reached.
- `no-progress` — consecutive idle turns (no non-signal tool calls) reached the convergence limit (`DEFAULT_GOAL_NO_PROGRESS_LIMIT = 2`).
- `cancelled` — the user cancelled via `cancelGoal()`.

Headless runs are fully autonomous until a stop condition fires; interactive (TUI) sessions auto-continue while the user may cancel at any time. Only `agent-wakeup` turns advance the goal — a user's own interjected message is not counted as a goal iteration.

## Unconnected Packages (Future Integration Targets)

| Package            | Current State                                            | Integration Direction                                               |
| ------------------ | -------------------------------------------------------- | ------------------------------------------------------------------- |
| **agent-tool-mcp** | Unconnected (no in-repo dependents; forward-provisioned) | Connect when MCP server is configured in InteractiveSession options |
| **agent-plugin**   | Unconnected (no in-repo dependents; forward-provisioned) | Inject plugins during Session/Robota creation                       |
