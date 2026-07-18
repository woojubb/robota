# Agent Core Specification

## Scope

- Owns the core Robota agent runtime, tool integration, conversation execution, and plugin-facing agent behavior.
- Defines the canonical agent orchestration surface used by provider and higher-level packages.
- Provides abstract base classes that provider packages and extensions must implement.

## Boundaries

- Keeps all provider-specific transport behavior in provider packages. Core must not branch on concrete provider names or model names.
- Keeps package-specific domain contracts owned once and reused through public surfaces.
- Does not own workflow visualization or session persistence; session persistence belongs to
  the session layer.
- **Zero dependency on other agent-\* packages.** `agent-core` must never import any other
  `@robota-sdk/agent-*` package as a production dependency. This is the foundation of the layered
  assembly architecture: other agent-\* packages register with agent-core through its abstract
  contracts; agent-core never depends on them. Plugins were externalized to external plugin packages specifically to preserve this constraint.

## Architecture Overview

### Layer Structure

```
Robota (Facade)
  ├── ExecutionService (Orchestrator)
  │     ├── AI Provider call (via AIProviders manager)
  │     └── Tool execution (via ToolExecutionService)
  ├── Manager Layer
  │     ├── AIProviders        — provider registration and selection
  │     ├── Tools              — tool registry and schema lookup
  │     ├── AgentFactory       — agent creation and lifecycle
  │     ├── ConversationHistory — session and message storage
  │     └── ModuleRegistry     — dynamic module loading
  ├── Service Layer
  │     ├── ExecutionService        — message handling, LLM calls, response assembly
  │     ├── ToolExecutionService    — schema validation, tool lookup, batch execution
  │     └── EventService            — unified event emission with ownerPath binding
  ├── Permission Layer
  │     ├── permission-gate.ts      — evaluatePermission(): 3-step deterministic policy
  │     ├── permission-mode.ts      — MODE_POLICY matrix, UNKNOWN_TOOL_FALLBACK
  │     └── types.ts                — TPermissionMode, TTrustLevel, TPermissionDecision
  ├── Hook Layer
  │     ├── hook-runner.ts          — runHooks(): pluggable hook execution engine (strategy pattern)
  │     ├── executors/
  │     │     ├── command-executor.ts — CommandExecutor: shell command hook execution
  │     │     └── http-executor.ts    — HttpExecutor: HTTP request hook execution
  │     └── types.ts                — THookEvent (16 events; catalog SSOT: docs/HOOK-CATALOG.md), THookDefinition (discriminated union), IHookTypeExecutor
  └── Plugin Layer (1 built-in + 8 plugin modules in the `@robota-sdk/agent-plugin` package)
        ├── EventEmitterPlugin           (built-in — event coordination)
        └── External plugins (per external plugin package):
              conversation-history, logging, usage, performance,
              execution-analytics, error-handling, limits, webhook
```

### Design Patterns

- **Facade**: `Robota` is the single entry point, hiding manager/service/plugin complexity.
- **Template Method**: `AbstractAgent` defines lifecycle hooks (`beforeRun`, `afterRun`, `onError`).
- **Strategy**: Event services, storage strategies, error handling strategies are interchangeable.
- **Registry**: `ToolRegistry` and `ModuleRegistry` for central resource management.
- **Null Object**: `SilentLogger` and `DefaultEventService` provide safe no-op defaults.
- **Factory**: `AgentFactory` for agent creation with lifecycle hooks.
- **Observer**: `EventEmitterPlugin` for pub/sub event coordination.

### Dependency Injection

All managers, services, and tools accept dependencies through constructor injection.
No global singletons exist. Each `Robota` instance is completely independent.

Safe defaults use the Null Object pattern:

- `SilentLogger` for logging (no side effects)
- `DEFAULT_ABSTRACT_EVENT_SERVICE` for events (no-op)

## Type Ownership

This package is the single source of truth (SSOT) for the following types:

| Type                                  | Location                                | Purpose                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------- | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TUniversalMessage`                   | `interfaces/messages.ts`                | Canonical message union (User, Assistant, System, Tool)                                                                                                                                                                                                                                                                     |
| `TUniversalMessageMetadata`           | `interfaces/messages.ts`                | Message metadata record. Values: `string \| number \| boolean \| Date \| string[] \| number[] \| Record<string, number>` (includes token usage objects)                                                                                                                                                                     |
| `TUniversalValue`                     | `interfaces/types.ts`                   | Recursive value type without `any`                                                                                                                                                                                                                                                                                          |
| `TMetadata`                           | `interfaces/types.ts`                   | Metadata record type                                                                                                                                                                                                                                                                                                        |
| `IAgentConfig`                        | `interfaces/agent.ts`                   | Agent configuration contract                                                                                                                                                                                                                                                                                                |
| `IAIProvider`                         | `interfaces/provider.ts`                | Provider integration contract                                                                                                                                                                                                                                                                                               |
| `IProviderCapabilities`               | `interfaces/provider.ts`                | Provider-neutral capability report for function calling and provider-native web search/fetch support.                                                                                                                                                                                                                       |
| `IProviderNativeWebToolRequest`       | `interfaces/provider.ts`                | Provider-neutral request shape for native web search/fetch enablement.                                                                                                                                                                                                                                                      |
| `IProviderNativeRawPayloadEvent`      | `interfaces/provider.ts`                | Provider-owned native SDK request/response/stream payload envelope emitted through `IChatOptions.onProviderNativeRawPayload` for replay-grade session logs without leaking provider SDK types into core.                                                                                                                    |
| `TProviderNativeRawPayloadCallback`   | `interfaces/provider.ts`                | Per-call callback type used by provider packages to report exact provider-native SDK payloads.                                                                                                                                                                                                                              |
| `TProviderNativeRawPayloadKind`       | `interfaces/provider.ts`                | Native payload phase union: `request`, `response`, or `stream_event`.                                                                                                                                                                                                                                                       |
| `IProviderDefinition`                 | `interfaces/provider-definition.ts`     | Provider assembly contract. Provider packages expose definitions with display metadata, compatibility aliases, defaults, official setup help links, setup prompts, credential requirements, model catalog fallback metadata, optional provider-owned catalog refresh hooks, probe hooks, and `createProvider()` factories.  |
| `IProviderSetupHelpLink`              | `interfaces/provider-definition.ts`     | Provider-owned official setup link metadata. Provider packages use it to expose API key, console, or official documentation URLs to generic setup flows without CLI/TUI provider-name branches.                                                                                                                             |
| `TProviderSetupHelpLinkKind`          | `interfaces/provider-definition.ts`     | Setup link kind union: `api-key`, `console`, or `official`, matching the preferred fallback order for provider setup guidance.                                                                                                                                                                                              |
| `IProviderModelCatalog`               | `interfaces/provider-definition.ts`     | Provider-owned model catalog contract used by command UX. Static entries are staleable fallback metadata with source and verification timestamps; live/generated catalogs come only from provider-owned refresh hooks.                                                                                                      |
| `IProviderModelCatalogEntry`          | `interfaces/provider-definition.ts`     | Minimal provider model metadata for display and selection. Provider packages own entries; generic layers must not hardcode provider-specific model lists.                                                                                                                                                                   |
| `IProviderModelCatalogRefreshOptions` | `interfaces/provider-definition.ts`     | Provider-neutral refresh input. Generic layers pass the effective provider profile to provider-owned refresh hooks without interpreting provider-specific model semantics.                                                                                                                                                  |
| `TProviderModelCatalogRefresh`        | `interfaces/provider-definition.ts`     | Async provider-owned catalog refresh hook type. Generic layers may invoke it through `IProviderDefinition` but must not implement provider-specific discovery.                                                                                                                                                              |
| `TProviderModelCatalogStatus`         | `interfaces/provider-definition.ts`     | Catalog freshness status union: `live`, `generated`, `fallback`, or `unavailable`.                                                                                                                                                                                                                                          |
| `TProviderModelLifecycle`             | `interfaces/provider-definition.ts`     | Provider model lifecycle union used by command UX to avoid presenting unavailable models as selectable subcommands.                                                                                                                                                                                                         |
| `TProviderModelCapability`            | `interfaces/provider-definition.ts`     | Minimal provider-owned model capability labels for display and filtering.                                                                                                                                                                                                                                                   |
| `IProviderDefinitionConfig`           | `interfaces/provider-definition.ts`     | Normalized provider configuration consumed by provider definitions, including `apiKey` and a provider-owned `options` bag that generic layers pass through without interpreting.                                                                                                                                            |
| `IProviderProbeResult`                | `interfaces/provider-definition.ts`     | Generic provider profile probe result used by CLI and setup flows without provider-specific branching.                                                                                                                                                                                                                      |
| `TMessageFormatConverter`             | `utils/message-converter.ts`            | Optional injected provider message conversion function. Concrete message conversion belongs to provider packages, not core.                                                                                                                                                                                                 |
| `TMessageConverterRegistry`           | `utils/message-converter.ts`            | Optional converter registry keyed by caller-owned identifiers. Core treats all keys uniformly and never recognizes provider names internally.                                                                                                                                                                               |
| `IToolSchema`                         | `interfaces/provider.ts`                | Tool schema contract, including root object `additionalProperties` for tools that intentionally tolerate unknown parameters                                                                                                                                                                                                 |
| `TToolParameters`                     | `interfaces/types.ts`                   | Tool parameter type (re-exported via `interfaces/tool.ts`)                                                                                                                                                                                                                                                                  |
| `IEventService`                       | `event-service/interfaces.ts`           | Event emission contract                                                                                                                                                                                                                                                                                                     |
| `IOwnerPathSegment`                   | `event-service/interfaces.ts`           | Execution path tracking                                                                                                                                                                                                                                                                                                     |
| `RobotaError`                         | `utils/errors.ts`                       | Base error hierarchy                                                                                                                                                                                                                                                                                                        |
| `TTextDeltaCallback`                  | `interfaces/provider.ts`                | Streaming text delta callback `(delta: string) => void`                                                                                                                                                                                                                                                                     |
| `TModelEffort`                        | `interfaces/provider.ts`                | SSOT reasoning-effort union: `'low' \| 'medium' \| 'high' \| 'xhigh' \| 'max'`. `'high'` is the neutral default applied at the framework→provider seam.                                                                                                                                                                     |
| `TPermissionMode`                     | `permissions/types.ts`                  | Permission modes: plan, default, acceptEdits, bypassPermissions                                                                                                                                                                                                                                                             |
| `TTrustLevel`                         | `permissions/types.ts`                  | Friendly trust aliases: safe, moderate, full                                                                                                                                                                                                                                                                                |
| `TPermissionDecision`                 | `permissions/types.ts`                  | Evaluation outcome: auto, approve, deny                                                                                                                                                                                                                                                                                     |
| `TToolArgs`                           | `permissions/permission-gate.ts`        | Tool arguments record for permission matching                                                                                                                                                                                                                                                                               |
| `IPermissionLists`                    | `permissions/permission-gate.ts`        | Allow/deny pattern lists for permission config                                                                                                                                                                                                                                                                              |
| `TKnownToolName`                      | `permissions/permission-mode.ts`        | Known tool names in the permission system                                                                                                                                                                                                                                                                                   |
| `THookEvent`                          | `hooks/types.ts`                        | Hook lifecycle events (16 events): PreToolUse, PostToolUse, PreCompact, PostCompact, SessionStart, SessionEnd, Stop, StopFailure, UserPromptSubmit, SubagentStart, SubagentStop, WorktreeCreate, WorktreeRemove, PreModelCall, PostModelCall, PermissionDecision (informational-only). Catalog SSOT: `docs/HOOK-CATALOG.md` |
| `TSessionEndReason`                   | `hooks/types.ts`                        | Claude Code compatible session end reason union: clear, resume, logout, prompt_input_exit, bypass_permissions_disabled, other                                                                                                                                                                                               |
| `THooksConfig`                        | `hooks/types.ts`                        | Complete hooks configuration: event to hook groups                                                                                                                                                                                                                                                                          |
| `IHookGroup`                          | `hooks/types.ts`                        | Hook group: matcher pattern + hook definitions                                                                                                                                                                                                                                                                              |
| `THookDefinition`                     | `hooks/types.ts`                        | Discriminated union hook definition (type: command, http, prompt, agent, guardrail)                                                                                                                                                                                                                                         |
| `ICommandHookDefinition`              | `hooks/types.ts`                        | Shell command hook: `type: 'command'`, `command: string`, optional `timeout`                                                                                                                                                                                                                                                |
| `IHttpHookDefinition`                 | `hooks/types.ts`                        | HTTP request hook: `type: 'http'`, `url: string`, optional `headers`, optional `timeout`                                                                                                                                                                                                                                    |
| `IPromptHookDefinition`               | `hooks/types.ts`                        | LLM prompt hook: `type: 'prompt'`, `prompt: string`, optional `model`                                                                                                                                                                                                                                                       |
| `IAgentHookDefinition`                | `hooks/types.ts`                        | Sub-agent hook: `type: 'agent'`, `agent: string`, optional `maxTurns`, optional `timeout`                                                                                                                                                                                                                                   |
| `IGuardrailHookDefinition`            | `hooks/types.ts`                        | SELFHOST-005 guardrail hook: `type: 'guardrail'`, optional `guardrails: string[]` (names to run; omitted = all)                                                                                                                                                                                                             |
| `IGuardrailResult`                    | `hooks/types.ts`                        | SELFHOST-005 guardrail verdict: `pass: boolean`, optional `reason` (`pass: false` fails the turn fast)                                                                                                                                                                                                                      |
| `TGuardrail`                          | `hooks/types.ts`                        | SELFHOST-005 registerable guardrail mechanism: `(input: IHookInput) => IGuardrailResult \| Promise<IGuardrailResult>`                                                                                                                                                                                                       |
| `GuardrailExecutor`                   | `hooks/executors/guardrail-executor.ts` | SELFHOST-005 `IHookTypeExecutor` (`type: 'guardrail'`): parallel fan-out + fail-fast over the registered guardrail set → exit-code-2/`blocked`                                                                                                                                                                              |
| `IHookTypeExecutor`                   | `hooks/types.ts`                        | Strategy interface for hook type execution                                                                                                                                                                                                                                                                                  |
| `IHookInput`                          | `hooks/types.ts`                        | Input passed to hook commands via stdin                                                                                                                                                                                                                                                                                     |
| `IHookResult`                         | `hooks/types.ts`                        | Hook execution result (exitCode, stdout, stderr)                                                                                                                                                                                                                                                                            |
| `IContextTokenUsage`                  | `context/types.ts`                      | Token usage from a single API call (input, output, cache tokens)                                                                                                                                                                                                                                                            |
| `IContextWindowState`                 | `context/types.ts`                      | Context window state snapshot (maxTokens, usedTokens, percentage)                                                                                                                                                                                                                                                           |
| `IContextTokenEstimate`               | `context/estimation.ts`                 | Effective context token estimate used by status display, session compaction policy, and execution safety guards                                                                                                                                                                                                             |
| `IContextTokenEstimateOptions`        | `context/estimation.ts`                 | Options for `estimateContextTokensFromMessages()`: optional `providerUsage` floor and `callerFloor`                                                                                                                                                                                                                         |
| `IMessageTokenUsage`                  | `context/token-usage.ts`                | Normalized token usage read from message metadata or provider usage payloads                                                                                                                                                                                                                                                |
| `IHistoryEntry`                       | `interfaces/messages.ts`                | Rich history entry that wraps a message with category, type, and structured data fields. Fields: `id` (string), `timestamp` (Date), `category` ('chat' \| 'event'), `type` (string), `data` (varies by category/type)                                                                                                       |
| `IActionRequest`                      | `interfaces/interaction.ts`             | UI-agnostic "ask the user" request (CMD-004). One shape covers confirm/single/multi/free-text/secret via `options` × `minSelect`/`maxSelect` × `allowFreeText` × `masked`. No function-valued fields (serialization-safe). SSOT lives in core so both command and tool sources reach it.                                    |
| `IActionOption` / `IActionDefault`    | `interfaces/interaction.ts`             | One selectable option, and the pre-selected values / prefilled text for an action request.                                                                                                                                                                                                                                  |
| `TActionResponse`                     | `interfaces/interaction.ts`             | Answer to an `IActionRequest`: `{ type: 'answer'; values; text? }` or `{ type: 'cancelled' }`.                                                                                                                                                                                                                              |
| `IUserInteraction`                    | `interfaces/interaction.ts`             | Injected ask port — `ask(IActionRequest): Promise<TActionResponse>`. The single seam every interaction source uses; concurrency (broadcast, first-answer-wins, idempotent resolve) is owned by the implementation.                                                                                                          |

Provider packages import these types. They must not re-declare them.

### Model Definitions (SSOT)

`context/models.ts` is the single source of truth for Claude model metadata. Source: https://platform.claude.com/docs/en/about-claude/models/overview

| Export                      | Kind      | Description                                          |
| --------------------------- | --------- | ---------------------------------------------------- |
| `IModelDefinition`          | Interface | Model metadata: name, id, contextWindow, maxOutput   |
| `CLAUDE_MODELS`             | Record    | All known Claude models (4.5+) keyed by API ID       |
| `DEFAULT_CONTEXT_WINDOW`    | Constant  | 200,000 tokens fallback                              |
| `DEFAULT_MAX_OUTPUT`        | Constant  | 16,384 tokens fallback for max output                |
| `getModelContextWindow(id)` | Function  | Get context window size for a model ID               |
| `getModelMaxOutput(id)`     | Function  | Get max output tokens for a model ID                 |
| `getModelName(id)`          | Function  | Get human-readable name (e.g., "Claude Sonnet 4.6")  |
| `formatTokenCount(tokens)`  | Function  | Format tokens as human-readable (e.g., "200K", "1M") |

### Model Pricing (SSOT)

`context/model-pricing.ts` is the single source of truth for per-model token cost. Consumers that
compute or estimate cost (cost display, budget/rate limiting) read from here rather than embedding
their own price tables. Prices are USD per 1,000,000 tokens.

| Export                            | Kind      | Description                                                                             |
| --------------------------------- | --------- | --------------------------------------------------------------------------------------- |
| `IModelPrice`                     | Interface | `{ inputPerMillion, outputPerMillion }`                                                 |
| `MODEL_PRICES`                    | Record    | Exact per-model prices keyed by API model ID                                            |
| `lookupModelPrice(id)`            | Function  | Resolve price by exact ID, then family pattern; `undefined` if unknown                  |
| `calculateModelCost(id, in, out)` | Function  | Exact USD cost for an input/output token split; `undefined` if the model is unknown     |
| `estimateBlendedCostPer1000(id)`  | Function  | Blended USD-per-1000 rate for budget estimation when no input/output split is available |

## Public API Surface

### Core

| Export                                  | Kind           | Description                                                                                                                                                                                                                                             |
| --------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Robota`                                | class          | Main agent facade                                                                                                                                                                                                                                       |
| `AbstractAgent`                         | abstract class | Base agent lifecycle                                                                                                                                                                                                                                    |
| `AbstractAIProvider`                    | abstract class | Base for provider implementations                                                                                                                                                                                                                       |
| `AbstractPlugin`                        | abstract class | Base for plugin extensions                                                                                                                                                                                                                              |
| `AbstractTool`                          | abstract class | Base for tool implementations                                                                                                                                                                                                                           |
| `AbstractExecutor`                      | abstract class | Base for execution strategies                                                                                                                                                                                                                           |
| `LocalExecutor`                         | class          | Local provider execution                                                                                                                                                                                                                                |
| `IProviderDefinition`                   | interface      | Provider assembly definition, including optional setup display metadata, official setup help links, compatibility aliases, defaults, credential requirements, model catalog fallback metadata, provider-owned refresh hooks, and provider-owned options |
| `IProviderSetupHelpLink`                | interface      | Provider-owned official setup link metadata rendered by generic setup flows                                                                                                                                                                             |
| `TProviderSetupHelpLinkKind`            | type           | Provider setup link kind union: `api-key`, `console`, or `official`                                                                                                                                                                                     |
| `IProviderModelCatalog`                 | interface      | Provider-owned model catalog source, freshness status, fallback/live entries, source URL, and `lastVerifiedAt` metadata                                                                                                                                 |
| `IProviderModelCatalogEntry`            | interface      | Minimal model display metadata for provider-aware command UX                                                                                                                                                                                            |
| `IProviderModelCatalogRefreshOptions`   | interface      | Provider-neutral refresh input containing the effective provider profile                                                                                                                                                                                |
| `TProviderModelCatalogRefresh`          | type           | Async provider-owned model catalog refresh hook                                                                                                                                                                                                         |
| `IProviderCredentialRequirement`        | interface      | Provider-owned credential requirement over the generic API-key credential field                                                                                                                                                                         |
| `TProviderModelCatalogStatus`           | type           | Catalog freshness status union                                                                                                                                                                                                                          |
| `TProviderModelLifecycle`               | type           | Model lifecycle union for provider-owned catalog entries                                                                                                                                                                                                |
| `TProviderModelCapability`              | type           | Provider-owned model capability labels                                                                                                                                                                                                                  |
| `IProviderCapabilities`                 | interface      | Provider-neutral capability report, including native web search/fetch support and enabled state                                                                                                                                                         |
| `IProviderNativeWebToolRequest`         | interface      | Provider-neutral requested native web search/fetch flags                                                                                                                                                                                                |
| `IProviderNativeRawPayloadEvent`        | interface      | Provider-owned native request/response/stream payload envelope routed through core execution events for replay logs                                                                                                                                     |
| `TProviderNativeRawPayloadCallback`     | type           | Per-call callback providers use to emit native payload events without mutating provider instances                                                                                                                                                       |
| `TProviderNativeRawPayloadKind`         | type           | `request`, `response`, or `stream_event` payload phase label                                                                                                                                                                                            |
| `getProviderCapabilities`               | function       | Return provider capabilities with safe defaults when a provider does not implement a capability hook                                                                                                                                                    |
| `assertProviderNativeWebToolsAvailable` | function       | Fail before provider transport execution when requested native web search/fetch is unsupported or disabled                                                                                                                                              |
| `findProviderDefinition`                | function       | Resolve an injected provider definition by canonical type or alias                                                                                                                                                                                      |
| `formatSupportedProviderTypes`          | function       | Format injected provider types and aliases for generic errors                                                                                                                                                                                           |
| `normalizeProviderConfig`               | function       | Resolve loose provider settings into a full `IProviderDefinitionConfig` (default model from `defaults.model`, `$ENV:` apiKey resolution)                                                                                                                |
| `createProviderFromConfig`              | function       | Construct an `IAIProvider` from a resolved config against the injected registry, enforcing the credential requirement                                                                                                                                   |

### Orchestration Public API (SELFHOST-001)

Neutral multi-agent orchestration runtime exports (the contracts/event-type unions are type-only; see `src/orchestration/`). agent-core OWNS these; the `agent-framework` layer IMPLEMENTS the mechanism.

| Export                           | Kind  | Description                                                                                                  |
| -------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------ |
| `ORCHESTRATION_EVENTS`           | const | Neutral orchestration lifecycle event names (`started`/`step_started`/`step_completed`/`completed`/`failed`) |
| `ORCHESTRATION_EVENT_PREFIX`     | const | Event-name prefix (`orchestration`) for the neutral orchestration lifecycle events                           |
| `TOrchestrationEvent`            | type  | Union of the orchestration lifecycle event names                                                             |
| `TOrchestrationPrimitive`        | type  | Named neutral primitives: `sequential`/`parallel`/`hierarchical`/`handoff`/`group-chat`                      |
| `IOrchestrationStep`             | type  | A neutral unit of work (id, label, agentType, prompt, optional model/tool scoping)                           |
| `ISequentialOrchestrationSpec`   | type  | Spec for a `sequential` run (ordered steps + `threadOutput`)                                                 |
| `IParallelOrchestrationSpec`     | type  | Spec for a `parallel` run (concurrent steps + bounded `maxConcurrency`)                                      |
| `IHandoffOrchestrationSpec`      | type  | Spec for a `handoff` run (control-transfer among steps; `entryStepId` + `maxHandoffs` loop bound)            |
| `IOrchestrationDelegation`       | type  | A neutral manager→worker delegation (`stepId` + `prompt`)                                                    |
| `IHierarchicalOrchestrationSpec` | type  | Spec for a `hierarchical` (manager-delegation) run (`managerStepId` + `maxRounds` loop bound)                |
| `IGroupChatOrchestrationSpec`    | type  | Spec for a `group-chat` (turn-taking) run (`firstStepId` + `maxTurns` loop bound)                            |
| `IOrchestrationStepResult`       | type  | One executed step's result (id, output, optional usage)                                                      |
| `IOrchestrationRunResult`        | type  | A run's result (primitive, per-step results, aggregate output)                                               |
| `IOrchestrationEventData`        | type  | Neutral event payload the primitives emit over `IEventService`                                               |

### Span Timing Public API (SELFHOST-004)

Per-operation timing SOURCE. agent-core measures the operation duration (e.g. `FunctionTool`), mints the span id, and emits a span-completion event whose payload JOINS `spanId + durationMs + op` (raw scalars only — references no transport type, so agent-core depends on neither `agent-interface-transport` nor `agent-plugin`; no cycle). A consuming layer (`agent-framework`) turns the event into a record span entry.

| Export                     | Kind     | Description                                                                                              |
| -------------------------- | -------- | -------------------------------------------------------------------------------------------------------- |
| `SPAN_EVENTS`              | const    | Span lifecycle event names (`span_completed`); mirrors the `TASK_EVENTS`/`USER_EVENTS` pattern           |
| `SPAN_EVENT_PREFIX`        | const    | Event-name prefix (`span`) for the span lifecycle events                                                 |
| `TSpanEvent`               | type     | Union of the span lifecycle event names                                                                  |
| `ISpanCompletionEventData` | type     | Span-completion payload joining `spanId` + `durationMs` + `op` (raw scalars; no transport dependency)    |
| `generateSpanId`           | function | Mint a unique `span_…` id for distributed-tracing correlation (also used to seed `IEventContext.spanId`) |

### Schema (CORE-015)

| Export                                                                                                    | Kind     | Description                                                                                                               |
| --------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------- |
| `zodToJsonSchema`                                                                                         | function | Zod → universal JSON-schema subset conversion (SSOT; moved from the tools package, which now imports it from core)        |
| `extractEnumValues`                                                                                       | function | Safe Zod enum value extraction                                                                                            |
| `hasValidationConstraints`                                                                                | function | Whether a Zod schema carries validation checks                                                                            |
| `getSchemaTypeName`                                                                                       | function | Safe Zod type-name extraction                                                                                             |
| `IZodSchema` / `IZodSchemaDef` / `IZodParseResult` / `ISchemaConversionOptions`                           | types    | Structural Zod compatibility types (no hard Zod version coupling in signatures)                                           |
| `normalizeStructuredOutput`                                                                               | function | Normalize `IRunOptions.output` (Zod schema or `IJsonSchemaOutput`) into `IStructuredOutputSpec`                           |
| `validateAgainstJsonSchema`                                                                               | function | Structural validation of a value against the universal JSON-schema subset                                                 |
| `parseStructuredResponseText`                                                                             | function | Parse a model's final text into JSON (tolerates one fenced json code block; value is still strictly validated afterwards) |
| `IJsonSchemaOutput` / `IStructuredOutputSpec` / `TStructuredOutputSchema` / `TStructuredOutputValidation` | types    | Structured output contract types                                                                                          |

### Tools

| Export         | Kind  | Description                                                                                                                                        |
| -------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FunctionTool` | class | Dependency-free JS-function tool primitive (`implements IFunctionTool`); honors `parameters.additionalProperties` validation (DATA-005 canonical). |
| `ToolRegistry` | class | Dependency-free tool registry primitive (`implements IToolRegistry`); central registration, lookup, and schema retrieval.                          |

NOTE: agent-core is the **single owner (SSOT)** of the concrete `ToolRegistry` / `FunctionTool` classes (`src/tool-registry/`, exported from the package barrel and constructed directly by the zero-dep `tool-manager`) — they are dependency-free runtime primitives whose contracts (`IToolRegistry` / `IFunctionTool`) already live in core (DATA-005, resolves ARL-01). The `createFunctionTool` / `createZodFunctionTool` tool constructors live in the tools layer and construct core's `FunctionTool`; `MCPTool` and `RelayMcpTool` live in the MCP-tool layer. `FunctionTool` parameter validation honors `schema.parameters.additionalProperties` (`true` / object-form accept extra props; `false`/omitted reject) via `src/tool-registry/parameter-validator.ts`. There is no `OpenAPITool` class in agent-core: OpenAPI tools are described only by the `IOpenAPIToolConfig` type and the `IToolFactory.createOpenAPITool()` factory port (no shipped class).

### Interaction (CMD-004)

UI-agnostic "ask the user" contract. The SSOT lives here so every interaction source reaches it:
command execution (`ICommandHostContext`, agent-framework) and tool execution
(`IToolExecutionContext.ask`, this package — model-issued questions, CMD-005). Transports render the
request per-environment; the contract carries no function-valued fields (serialization-safe).

| Export                                                                | Kind      | Description                                                                               |
| --------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------- |
| `IActionRequest` / `IActionOption` / `IActionDefault`                 | interface | The single action request shape, its options, and pre-selection/prefill                   |
| `TActionResponse`                                                     | type      | `{ type: 'answer'; values; text? }` or `{ type: 'cancelled' }`                            |
| `IUserInteraction`                                                    | interface | Injected ask port: `ask(IActionRequest): Promise<TActionResponse>`                        |
| `confirmAction` / `selectAction` / `multiSelectAction` / `textAction` | function  | Ergonomic constructors for confirm / single / multi / free-text (incl. `masked`) requests |
| `isConfirmed`                                                         | function  | Read a `confirmAction` answer as a boolean                                                |
| `CONFIRM_YES` / `CONFIRM_NO`                                          | const     | Option values used by `confirmAction` / `isConfirmed`                                     |

`IToolExecutionContext` gains an optional `ask?: IUserInteraction['ask']` — present when an interactive
renderer is attached; a tool treats absence as "no human available" (never a silent guess).

### Permissions

| Export                  | Kind     | Description                                                                                        |
| ----------------------- | -------- | -------------------------------------------------------------------------------------------------- |
| `evaluatePermission`    | function | 3-step deterministic policy: deny list, allow list, mode                                           |
| `MODE_POLICY`           | const    | Permission mode to tool decision matrix                                                            |
| `TRUST_TO_MODE`         | const    | Maps TTrustLevel to TPermissionMode                                                                |
| `UNKNOWN_TOOL_FALLBACK` | const    | Fallback decisions for unknown tools per mode                                                      |
| `TPermissionMode`       | type     | `'plan' \| 'default' \| 'acceptEdits' \| 'bypassPermissions'`                                      |
| `TTrustLevel`           | type     | `'safe' \| 'moderate' \| 'full'`                                                                   |
| `TPermissionDecision`   | type     | `'auto' \| 'approve' \| 'deny'`                                                                    |
| `TToolArgs`             | type     | Tool arguments record for permission matching                                                      |
| `IPermissionLists`      | type     | Allow/deny pattern lists                                                                           |
| `TKnownToolName`        | type     | Known tool names: Shell, Bash, Read, Write, Edit, Glob, Grep, WebFetch, WebSearch, AskUserQuestion |

### Environment Reference Utilities

Zero-dependency utilities for the `$ENV:<name>` environment variable reference format. This is the
canonical location for env-ref logic; all higher layers import from here.

| Export                     | Kind     | Description                                                               |
| -------------------------- | -------- | ------------------------------------------------------------------------- |
| `ENV_REFERENCE_PREFIX`     | const    | `'$ENV:'` — the canonical prefix for environment variable references      |
| `isEnvReference`           | function | Return true when a string starts with `$ENV:`                             |
| `formatEnvReference`       | function | Return the `$ENV:<name>` formatted string for the given variable name     |
| `resolveEnvReference`      | function | Resolve `$ENV:<name>` → `process.env[name]`; return value or `undefined`  |
| `hasUsableSecretReference` | function | Return true when the value is a non-empty string that resolves to a value |

### Cross-platform Shell Resolution

Zero-dependency SSOT (TERM-008) for "which shell to spawn, and how". Pure function of `(env, platform)`
so every per-OS branch is testable without touching the host. Consumed by every shell-running site:
the `Shell`/`Bash` tool (agent-tools), the hook `command` executor, and the interactive drop-to-shell
(agent-command). Resolution: `ROBOTA_SHELL` override wins on any platform; **win32** → PowerShell (cmd
via override); **posix** → `$SHELL` else `/bin/sh`. The returned `syntaxHint`/`label` name the OS family
(macOS BSD vs Linux GNU vs Windows PowerShell) so an LLM authoring commands avoids cross-OS flag mistakes.

| Export                 | Kind      | Description                                                                                 |
| ---------------------- | --------- | ------------------------------------------------------------------------------------------- |
| `resolvePlatformShell` | function  | Resolve the active shell for `(env, platform)` → `IPlatformShell`                           |
| `IPlatformShell`       | interface | `command`, `kind`, `platform`, `commandArgs(cmd)`, `interactiveArgs`, `label`, `syntaxHint` |
| `TShellKind`           | type      | `'bash' \| 'sh' \| 'powershell' \| 'cmd'`                                                   |

### Hooks

| Export                   | Kind      | Description                                                                                                                                                                                  |
| ------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runHooks`               | function  | Execute hooks for lifecycle events using pluggable type executors; returns `IRunHooksResult`                                                                                                 |
| `GuardrailExecutor`      | class     | SELFHOST-005 `IHookTypeExecutor` (`type: 'guardrail'`): runs the registered guardrail set in parallel and fails fast → exit-code-2/`blocked` (constructed with the consumer's guardrail map) |
| `THookEvent`             | type      | 13 events: PreToolUse, PostToolUse, SessionStart, SessionEnd, Stop, StopFailure, PreCompact, PostCompact, UserPromptSubmit, SubagentStart, SubagentStop, WorktreeCreate, WorktreeRemove      |
| `TSessionEndReason`      | type      | Session end reason union: clear, resume, logout, prompt_input_exit, bypass_permissions_disabled, other                                                                                       |
| `THooksConfig`           | type      | Event to hook group array mapping                                                                                                                                                            |
| `IHookGroup`             | type      | Matcher pattern + hook definitions array; optional `env` for child-process environment injection                                                                                             |
| `THookDefinition`        | type      | Discriminated union of all hook definition types: command, http, prompt, agent                                                                                                               |
| `ICommandHookDefinition` | interface | `type: 'command'` hook — shell command execution via stdin/exit code                                                                                                                         |
| `IHttpHookDefinition`    | interface | `type: 'http'` hook — HTTP request to external endpoint                                                                                                                                      |
| `IPromptHookDefinition`  | interface | `type: 'prompt'` hook — LLM prompt injection                                                                                                                                                 |
| `IAgentHookDefinition`   | interface | `type: 'agent'` hook — sub-agent delegation                                                                                                                                                  |
| `IHookTypeExecutor`      | interface | Strategy interface for executing a specific hook type                                                                                                                                        |
| `IHookInput`             | type      | JSON input passed to hooks via stdin                                                                                                                                                         |
| `IHookResult`            | type      | Hook result: exitCode (0=allow, 2=block), stdout, stderr                                                                                                                                     |

NOTE: `CommandExecutor` and `HttpExecutor` are exported from `hooks/index.ts` but are **not** re-exported from `src/index.ts`. They are available to packages that import directly from the hooks sub-path; consumers that only import from `@robota-sdk/agent-core` must supply custom executors via the `executors` parameter of `runHooks`. `IRunHooksResult` follows the same export boundary.

### Streaming

| Export               | Kind | Description                                         |
| -------------------- | ---- | --------------------------------------------------- |
| `TTextDeltaCallback` | type | `(delta: string) => void` — streaming text callback |

This callback is declared in `IChatOptions.onTextDelta` and `IRunOptions.onTextDelta`. Provider implementations use `IChatOptions.onTextDelta` to emit text chunks during streaming responses. The execution engine (`execution-round.ts`, `execution-pipeline.ts`) uses only `IRunOptions.onTextDelta` (the run-scoped callback) — there is no fallback to a provider instance-level callback. Callers must pass the callback explicitly through the run context. Provider instance-level `onTextDelta` properties (if any) are a provider-internal concern and must not be relied upon by agent-core.

### Cancellation Contract (CORE-018)

`IRunOptions.signal` is the single cancellation source for a run. The contract:

1. **run path**: the signal gates the run queue (`enqueueRun`), every provider call
   (`IChatOptions.signal`), and every tool execution.
2. **runStream path (parity)**: the streaming context is built by the SAME `buildRunContext`
   as the round path — the historical inline construction dropped `signal` (and every other
   run option added after it), which made the public streaming API uncancellable. The
   `executeStream` chat options carry `context.signal`.
3. **Tool executions**: `IToolExecutionContext.signal` carries the run signal into every
   tool call. The batch executor threads it; long-running built-ins MUST honor it —
   `shell` kills the child process, `web_fetch`/`web_search` abort the network request,
   MCP tool calls abort the in-flight HTTP request. A tool observing an abort terminates
   its work and returns an interrupted/failed result — silently completing after abort is
   a contract violation.
4. **Abort classification**: an aborted run resolves as `interrupted`, never as a provider
   error and never as a successful completion.

### Reasoning Effort

| Export         | Kind | Description                                                                                                           |
| -------------- | ---- | --------------------------------------------------------------------------------------------------------------------- |
| `TModelEffort` | type | SSOT reasoning-effort union: `'low' \| 'medium' \| 'high' \| 'xhigh' \| 'max'`. `'high'` is the neutral default tier. |

`TModelEffort` (declared in `interfaces/provider.ts`) is the single source of truth for the
reasoning-effort dial. The `effort` value flows through one channel from configuration to provider:

- `IModelConfig.effort` (`src/core/robota-types.ts`) — the shared model-config shape used by
  `setModel`/`getModel`.
- `IAgentConfig.defaultModel.effort` (`src/interfaces/agent.ts`) — the agent-config default-model
  effort threaded into execution.
- `IChatOptions.effort` (`src/interfaces/provider.ts`) — the per-invocation effort passed to provider
  `chat()`.

`setModel` writes the effort into agent config (`src/core/robota-config-manager.ts`). At the
framework→provider seam, `execution-round-provider.ts` defaults it to `'high'`
(`config.defaultModel.effort ?? 'high'`) so every model call carries an explicit effort. Native-effort
providers map it to their request parameter; providers without a native effort concept ignore it as a
documented no-op. Core must not branch on provider names to apply effort.

`setModel` requires the agent to be fully initialized (providers registered + current provider set),
which otherwise happens lazily on the first `run()`. `Robota.ensureReady()` performs that
initialization without running a turn (idempotent), so callers that mutate runtime configuration
before the first turn — e.g. live preset/model switching on a fresh interactive session — call
`ensureReady()` first instead of hitting the "must be fully initialized" guard.

### Provider-Native Replay Payloads

`IChatOptions.onProviderNativeRawPayload` is the provider-neutral callback bridge for replay-grade raw payload capture. Provider packages own the native SDK request/response/stream objects and call this callback with `IProviderNativeRawPayloadEvent`:

- `provider`: concrete provider identifier as known by the provider package.
- `apiSurface`: optional provider-owned API surface label such as `responses`, `chat-completions`, `anthropic-messages`, or `gemini-generate-content`.
- `payloadKind`: `request`, `response`, or `stream_event`.
- `sequence`: optional provider-owned stream/request order. Core assigns a monotonically increasing fallback when omitted.
- `payload`: the SDK-native payload object or primitive chosen by the provider package.
- `metadata`: provider-owned scalar diagnostics only.

`agent-core` must not import concrete provider SDK types, inspect provider names, or choose provider-specific payload fields. During a provider call, core wraps the callback and emits a `provider_native_raw_payload` execution event with the current `executionId`, `conversationId`, and `round`. The existing `provider_response_raw` event remains the provider-normalized Robota message snapshot and is not a substitute for provider-native payload capture.

### Provider Contract — dual surface (intentional)

`IAIProvider` deliberately exposes two request/response surfaces, and every provider implements both:

- **Universal (public):** `chat(messages, options)` / `chatStream(...)` operate on `TUniversalMessage`.
  This is the provider-neutral surface that generic layers and SDK consumers use.
- **Raw (internal protocol path):** `generateResponse(payload)` / `generateStreamingResponse(payload)`
  operate on `IProviderRequest` / `IRawProviderResponse`. These are consumed by the core
  `conversation-service` to thread provider-native request/response payloads (e.g. for the
  `provider_native_raw_payload` event). They are **not** the public consumer API.

The two surfaces share one interface because a provider instance is legitimately both a universal and
a raw provider; the raw methods are an internal-protocol detail, not a parallel public API. Generic
layers and applications must use `chat`/`chatStream`; only the conversation service drives the raw path.

### Provider Capabilities

`IAIProvider.getCapabilities()` is an optional provider hook. `AbstractAIProvider` supplies a default implementation reporting function-calling support from `supportsTools()` and provider-native web search/fetch as unsupported. Generic layers must call `getProviderCapabilities(provider)` instead of branching on provider names.

Provider-native web tools are not the same as Robota local function tools:

- `nativeWebTools.webSearch.supported` means the provider package has a documented hosted/server-side search path.
- `nativeWebTools.webSearch.enabled` means that hosted path is active for the current provider instance.
- `nativeWebTools.webFetch.supported` and `enabled` follow the same semantics for provider-side page extraction/fetch behavior.
- `IChatOptions.nativeWebTools` requests provider-native hosted web behavior for one call. Providers must call `assertProviderNativeWebToolsAvailable()` before transport execution so unsupported or disabled native web requests fail before streaming starts.
- `IAIProvider.configureNativeWebTools()` is an optional provider hook for session/runtime assembly. Session layers may call it to enable provider-owned native web tools without importing concrete provider classes or checking provider names.

Robota local `WebSearch` and `WebFetch` tools remain ordinary function tools owned by the tools layer; they are advertised through tool schemas and do not make `nativeWebTools` supported.

### Context Window Tracking

| Export                              | Kind      | Description                                                                                        |
| ----------------------------------- | --------- | -------------------------------------------------------------------------------------------------- |
| `IContextTokenUsage`                | interface | Token usage from a single API call (inputTokens, outputTokens, cache)                              |
| `IContextWindowState`               | interface | Context window state snapshot (maxTokens, usedTokens, usedPercentage)                              |
| `IContextTokenEstimate`             | interface | Effective estimate with serialized, provider, and caller floor token candidates                    |
| `IMessageTokenUsage`                | interface | Normalized message token usage from metadata or provider usage payloads                            |
| `estimateContextTokensFromMessages` | function  | Returns the maximum effective token estimate from serialized messages and latest provider metadata |
| `estimateSerializedContextTokens`   | function  | Deterministic serialized-history fallback estimate                                                 |
| `readTokenUsageFromMessage`         | function  | Reads normalized token usage from a single message                                                 |

These types and helpers are consumed by the session layer to track effective token usage and context window state across conversation turns. When latest provider usage belongs to the terminal message, it is treated as the exact post-response state. When metadata-free user or tool messages follow the latest provider usage, the estimate becomes `max(serialized history estimate, latest provider usage, optional caller floor)`. Historical full-request provider usage is not summed. This prevents previous provider metadata from hiding a large metadata-free prompt and prevents multi-turn provider input counts from being double-counted.

Provider response usage is normalized before assistant messages are committed:

- `inputTokens`/`outputTokens` metadata is the canonical history form for context accounting.
- Provider-normalized `promptTokens`/`completionTokens`/`totalTokens` metadata and assistant `usage` payloads are accepted and converted to the same canonical metadata.
- Core must not branch on provider names to perform this conversion.
- If no exact provider usage exists, context accounting falls back to deterministic character-based estimation.

### History Entry Helpers

| Export                  | Kind      | Description                                                                                                 |
| ----------------------- | --------- | ----------------------------------------------------------------------------------------------------------- |
| `IHistoryEntry`         | interface | Rich history entry: `id`, `timestamp`, `category` ('chat' \| 'event'), `type`, `data`                       |
| `isChatEntry`           | function  | Type guard: `(entry: IHistoryEntry) => entry is IChatHistoryEntry` — narrows to chat category entries       |
| `chatEntryToMessage`    | function  | Converts an `IChatHistoryEntry` to a `TUniversalMessage` for API use                                        |
| `messageToHistoryEntry` | function  | Converts a `TUniversalMessage` to an `IHistoryEntry` with `category: 'chat'`                                |
| `getMessagesForAPI`     | function  | Extracts `TUniversalMessage[]` from `IHistoryEntry[]` for provider API calls (filters to chat entries only) |

### Managers

| Export                | Kind  | Description                   |
| --------------------- | ----- | ----------------------------- |
| `AgentFactory`        | class | Agent creation and lifecycle  |
| `AgentTemplates`      | class | Template-based agent creation |
| `ConversationHistory` | class | History management            |
| `ConversationStore`   | class | Session management            |

### Services

| Export                   | Kind          | Description               |
| ------------------------ | ------------- | ------------------------- |
| `EventHistoryModule`     | class         | Event recording           |
| `AbstractEventService`   | abstract base | `IEventService` base      |
| `DefaultEventService`    | class         | Null-object event service |
| `StructuredEventService` | class         | Structured event service  |
| `ObservableEventService` | class         | Observable event service  |

Note: `AbstractEventService`, `DefaultEventService`, `StructuredEventService`, and `ObservableEventService` are part of the public surface — all four are exported from `src/index.ts` and appear in the Class Contract Registry.

### Plugins (1 built-in)

| Plugin               | Category         | Description        |
| -------------------- | ---------------- | ------------------ |
| `EventEmitterPlugin` | event_processing | Event coordination |

8 plugins were extracted to external plugin packages to comply with the agent-core zero-dependency rule. They extend `AbstractPlugin` (defined here) and are wired by the consuming layer.

## Plugin Contract

Plugins extend `AbstractPlugin` and implement lifecycle hooks:

| Hook                  | Timing             | Purpose                          |
| --------------------- | ------------------ | -------------------------------- |
| `beforeRun`           | Before LLM call    | Input transformation, validation |
| `afterRun`            | After LLM response | Output processing, recording     |
| `onError`             | On execution error | Error handling, recovery         |
| `onStreamChunk`       | During streaming   | Chunk processing                 |
| `beforeToolExecution` | Before tool call   | Tool input validation            |
| `afterToolExecution`  | After tool result  | Tool output processing           |

Plugins declare `category` (PluginCategory) and `priority` (PluginPriority) for execution ordering.

### Disposal Chain Contract (CORE-022)

Component-level disposal has exactly one entry point; agent-level destruction drives it:

1. **`dispose()` is the component contract.** `AbstractPlugin.dispose()` is the single
   disposal entry point for plugins (matching modules, providers, and executors, which
   already use `dispose()`). A plugin owning resources — timers, sockets, storage handles —
   MUST override `dispose()` and release them (calling `super.dispose()` to unsubscribe
   module events). `destroy()` methods on plugins are not part of the contract and do not
   exist.
2. **`Robota.destroy()` is the agent-level terminal operation.** It awaits the run-queue
   tail (in-flight and already-queued runs settle first), disposes every registered plugin
   via `dispose()`, disposes modules and the internal event emitter, resets state, and
   marks the instance destroyed. Best-effort per CORE-013: step failures are collected,
   never thrown.
3. **`destroyed` is terminal.** Once `destroy()` is initiated, new `run()` / `runStream()`
   calls reject with a `[LIFECYCLE]` error and re-initialization is impossible — a
   destroyed agent never revives. Repeated `destroy()` is idempotent.
4. **Failed initialization is not cached.** When async initialization rejects, the cached
   init promise is cleared so a subsequent call can retry (before destruction); the
   original failure propagates to the awaiting caller.

After the owning runtime's shutdown completes, the agent must hold no live timers or
listeners — a process kept alive by an undisposed plugin resource is a contract violation
(live-confirmed: an undisposed flush interval hung the CORE-021 probe indefinitely).

### EventEmitterPlugin Error Containment (CORE-021)

Handler failures must never take down the process:

1. **`catchErrors: true` (default)** — a throwing handler is recorded in metrics and
   structured-logged, and the error is **swallowed** (never rethrown to the emitter caller).
   `catchErrors: false` rethrows to the caller after recording metrics.
2. **No floating flush.** The buffered-mode flush timer must attach a rejection handler to
   every `flushBuffer()` it schedules — a handler error surfacing through a floating flush
   promise is an unhandled rejection (process death on Node 20+), which violates item 1.

## Event Architecture

### Event Naming

Full event names follow the pattern `ownerType.localName`:

| Prefix        | Owner                | Examples                                     |
| ------------- | -------------------- | -------------------------------------------- |
| `execution.*` | ExecutionService     | `execution.start`, `execution.complete`      |
| `tool.*`      | ToolExecutionService | `tool.execute_start`, `tool.execute_success` |
| `agent.*`     | Robota               | `agent.completion`, `agent.created`          |
| `task.*`      | Task system          | `task.started`, `task.completed`             |
| `user.*`      | User actions         | `user.input`                                 |

### Owner Path Tracking

Each event carries an `ownerPath` array of `IOwnerPathSegment` objects that traces the execution hierarchy:

```typescript
interface IOwnerPathSegment {
  ownerType: string; // 'agent' | 'tool' | 'execution'
  ownerId: string;
}
```

Events are bound to their owner via `bindWithOwnerPath()`.

## Permission System

The permission module (`src/permissions/`) provides a deterministic, three-step policy evaluation for tool calls. It is consumed by the session layer to gate tool execution before delegating to the actual tool.

### Evaluation Algorithm (`evaluatePermission`)

1. **Deny list match** -- If any deny pattern matches the tool invocation, return `'deny'`.
2. **Allow list match** -- If any allow pattern matches, return `'auto'` (proceed without prompting).
3. **Mode policy lookup** -- Look up the tool in `MODE_POLICY[mode]`. If found, return the mapped decision. Otherwise, return `UNKNOWN_TOOL_FALLBACK[mode]`.

### Permission Modes

| Mode                | Read tools | Write tools      | Bash             |
| ------------------- | ---------- | ---------------- | ---------------- |
| `plan`              | auto       | deny             | deny             |
| `default`           | auto       | approve (prompt) | approve (prompt) |
| `acceptEdits`       | auto       | auto             | approve (prompt) |
| `bypassPermissions` | auto       | auto             | auto             |

### Pattern Syntax

Patterns follow the format `ToolName(argGlob)`:

- `Bash(pnpm *)` -- Bash tool whose command starts with "pnpm "
- `Read(/src/**)` -- Read tool whose filePath is under /src/
- `Write(*)` -- Write tool with any argument
- `ToolName` -- Match any invocation of that tool (no argument constraint)

## Hook System

The hook module (`src/hooks/`) provides a pluggable lifecycle hook mechanism. Hooks support multiple execution types (command, http, prompt, agent) via the strategy pattern. Command hooks receive JSON input on stdin and communicate results via exit codes.

### Hook Events

| Event              | Timing                    | Purpose                                          |
| ------------------ | ------------------------- | ------------------------------------------------ |
| `PreToolUse`       | Before tool execution     | Validation, blocking, transformation             |
| `PostToolUse`      | After tool execution      | Logging, auditing, notification                  |
| `SessionStart`     | Session initialization    | Setup, environment checks                        |
| `SessionEnd`       | Session completion        | Final cleanup, summary logging                   |
| `Stop`             | Session stop (success)    | Cleanup, reporting                               |
| `StopFailure`      | Session stop (failure)    | Error reporting, rollback                        |
| `PreCompact`       | Before context compaction | Validation, logging (trigger: auto/manual)       |
| `PostCompact`      | After context compaction  | Logging, notification (includes compact_summary) |
| `UserPromptSubmit` | After user submits prompt | Pre-processing, validation, prompt rewriting     |
| `SubagentStart`    | Before subagent launch    | Resource allocation, permission checks           |
| `SubagentStop`     | After subagent completion | Resource cleanup, result aggregation             |
| `WorktreeCreate`   | After worktree creation   | Workspace setup, environment initialization      |
| `WorktreeRemove`   | After worktree removal    | Workspace cleanup, resource release              |

### Hook Definition Types (Discriminated Union)

`IHookDefinition` is a discriminated union on the `type` field:

| Type      | Fields                               | Description                                         |
| --------- | ------------------------------------ | --------------------------------------------------- |
| `command` | `command: string`                    | Shell command execution (stdin JSON, exit codes)    |
| `http`    | `url: string`, `method?`, `headers?` | HTTP request to an external endpoint                |
| `prompt`  | `prompt: string`                     | LLM prompt injection into session context           |
| `agent`   | `agent: string`, `config?`           | Delegate to a nested agent execution for processing |

### Hook Type Executors (Strategy Pattern)

`IHookTypeExecutor` defines the strategy interface for executing a specific hook type:

```typescript
interface IHookTypeExecutor {
  readonly type: string;
  execute(hook: IHookDefinition, input: IHookInput): Promise<IHookResult>;
}
```

`runHooks` accepts an optional `executors` map to register additional hook type executors beyond the built-in ones. This enables higher-level packages to add `prompt` and `agent` executors without modifying agent-core.

**Built-in executors (agent-core):**

| Executor          | Hook Type | Behavior                                                     |
| ----------------- | --------- | ------------------------------------------------------------ |
| `CommandExecutor` | `command` | Spawns shell process, passes JSON via stdin, reads exit code |
| `HttpExecutor`    | `http`    | Sends HTTP request, maps response status to exit code        |

**Extended executors (agent-framework):**

| Executor         | Hook Type | Behavior                                                   |
| ---------------- | --------- | ---------------------------------------------------------- |
| `PromptExecutor` | `prompt`  | Injects prompt text into session context                   |
| `AgentExecutor`  | `agent`   | Delegates to a nested agent session for complex processing |

### Exit Code Protocol

| Code  | Meaning                        |
| ----- | ------------------------------ |
| 0     | Allow / proceed                |
| 2     | Block / deny (stderr = reason) |
| other | Proceed with warning           |

### Hook Configuration

Hooks are configured as a `THooksConfig` object mapping events to arrays of `IHookGroup` entries. Each group has a `matcher` regex pattern (empty = match all) and an array of `IHookDefinition` entries. Hooks have a 10-second timeout.

## Abort Execution Support

The execution loop supports cooperative cancellation via the standard `AbortSignal` API. An `AbortSignal` can be threaded through the entire execution pipeline to allow callers to cancel in-progress runs.

### Interface Changes

| Interface                    | Field                                        | Description                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `IRunOptions`                | `signal?: AbortSignal`                       | Allows callers to cancel execution of `Robota.run()`                                                                                                                                                                                                                                                                                                                                                        |
| `IRunOptions`                | `onTextDelta?: TTextDeltaCallback`           | Per-run streaming callback forwarded through execution context                                                                                                                                                                                                                                                                                                                                              |
| `IRunOptions`                | `allowToolOnlyCompletion?: boolean`          | CORE-011: a turn ending in tool calls is a valid completion — skips the forced summary call (decision-agent pattern); the forced-summary path also honors an aborted signal                                                                                                                                                                                                                                 |
| `IRunOptions`                | `maxTokens?` / `temperature?`                | CORE-016: run-scoped model option overrides — win over `defaultModel.*`; threaded to BOTH the run round path and the runStream path (the streaming path previously dropped them)                                                                                                                                                                                                                            |
| `IRunOptions`                | `toolChoice?: TToolChoice`                   | CORE-017: run-scoped tool-invocation directive (`'auto' \| 'none' \| 'required' \| { tool }`) — wins over `defaultModel.toolChoice`; threaded to both paths; a named tool missing from the run's tool list (or `'required'`/named with no tools) throws instead of degrading silently; forcing applies to the run's FIRST model call only — later rounds revert to `'auto'` so tool results can be consumed |
| `IRunOptions`                | `ephemeralSystemContext?: string`            | SELFHOST-008 P3: a transient system-role block added to a DERIVED provider-message array for this run only (`executeRound`), sent to the model but NEVER written to the conversation store — no history bloat, no static-system-prompt rebuild. Content-free neutral channel (caller decides the content, e.g. per-turn recalled memory)                                                                    |
| `IRunOptions`                | `output?: TStructuredOutputSchema`           | CORE-015: schema-enforced structured output — `run` resolves to the validated typed object instead of a string (see Structured Output Contract)                                                                                                                                                                                                                                                             |
| `IRunOptions`                | `outputRetries?: number`                     | CORE-015: validation-retry budget after the first attempt (default 2); only meaningful with `output`                                                                                                                                                                                                                                                                                                        |
| `IRunOptions`                | `onExecutionEvent?: TExecutionEventCallback` | Per-run replay event callback for provider/tool boundaries                                                                                                                                                                                                                                                                                                                                                  |
| `IRunOptions`                | `maxExecutionRounds?: number`                | Maximum model/tool rounds for one run. `0` means unlimited.                                                                                                                                                                                                                                                                                                                                                 |
| `IRunOptions`                | `maxSameToolInputs?: number`                 | Abort if the same tool is called with identical inputs N or more times in one run.                                                                                                                                                                                                                                                                                                                          |
| `IChatOptions`               | `signal?: AbortSignal`                       | Passed to provider `chat()` / `chatStream()` for cancelling calls                                                                                                                                                                                                                                                                                                                                           |
| `IChatOptions`               | `responseFormat` `json_schema` variant       | CORE-015: `{ type: 'json_schema', name?, schema }` carries the structured-output schema to provider native surfaces                                                                                                                                                                                                                                                                                         |
| `IAgentConfig`               | `timeout?: number`                           | Provider idle timeout in milliseconds for a model call                                                                                                                                                                                                                                                                                                                                                      |
| `IAgentConfig`               | `retainHistory?: boolean`                    | CORE-014: default `true` (history accumulates; full history sent every call). `false` = run-isolated mode: the conversation store resets after every run settles (success/abort/error), system prompt re-applies next run (CORE-010); pre-run injected context is visible to that run only                                                                                                                  |
| `IAgentConfig`               | `maxExecutionRounds?: number`                | Default maximum model/tool rounds for each run. `0` means unlimited.                                                                                                                                                                                                                                                                                                                                        |
| `IAgentConfig`               | `maxSameToolInputs?: number`                 | Config-level default for the identical-tool-input abort threshold.                                                                                                                                                                                                                                                                                                                                          |
| `IExecutionContext`          | `signal?: AbortSignal`                       | Threaded through the execution context for round-level checks                                                                                                                                                                                                                                                                                                                                               |
| `IExecutionContext`          | `onTextDelta?: TTextDeltaCallback`           | Run-scoped callback used before provider-level callback fallback                                                                                                                                                                                                                                                                                                                                            |
| `IExecutionContext`          | `onExecutionEvent?: TExecutionEventCallback` | Internal replay event callback forwarded to provider/tool rounds                                                                                                                                                                                                                                                                                                                                            |
| `IExecutionContext`          | `maxExecutionRounds?: number`                | Run-scoped override for execution round limit                                                                                                                                                                                                                                                                                                                                                               |
| `IExecutionContext`          | `maxSameToolInputs?: number`                 | Run-scoped override for the identical-tool-input abort threshold.                                                                                                                                                                                                                                                                                                                                           |
| `ICoreExecutionResult`       | `interrupted?: boolean`                      | Indicates the execution was aborted before natural completion                                                                                                                                                                                                                                                                                                                                               |
| `ICoreExecutionResult`       | `success` / `error` on provider failure      | A round ending in a provider failure records the error as an assistant message with `providerError` metadata; `buildFinalResult` must mark that result `success: false` with `error` set (never a successful response), so `robotaRun`'s failed-result throw surfaces it to transports                                                                                                                      |
| `ICoreExecutionResult`       | `error` REQUIRED on every failed result      | CORE-020: every `success: false` result carries `error: Error`, and `response` never carries error text (no `"Error: ..."` injection) — a failure must reach `run()` callers as a rejection, never as a normal-looking response string. `robotaRun` throws `result.error` for any non-interrupted failed result                                                                                             |
| `IToolExecutionBatchContext` | `signal?: AbortSignal`                       | Allows skipping queued tool executions when abort is signalled                                                                                                                                                                                                                                                                                                                                              |
| `IToolExecutionBatchContext` | `maxConcurrency?: number`                    | Bounds active tool executions when batch mode is `parallel`                                                                                                                                                                                                                                                                                                                                                 |

### Replay Boundary Events

`onExecutionEvent` emits provider-neutral, append-only replay events. `agent-core` must not expose concrete provider SDK objects or branch on provider names. The required event families are:

| Event                          | Emitted When                                      | Required Data                                                                                            |
| ------------------------------ | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `provider_request`             | Immediately before a provider call                | executionId, conversationId, round, provider, model, messages, tools                                     |
| `provider_stream_raw_delta`    | A provider text delta reaches core streaming path | executionId, conversationId, round, sequence, delta                                                      |
| `provider_response_raw`        | Immediately after provider `chat()` returns       | executionId, conversationId, round, response, responseKind                                               |
| `provider_response_normalized` | After provider response is accepted by core       | executionId, conversationId, round, response, toolCallsCount                                             |
| `assistant_message_committed`  | Assistant message is committed to history         | executionId, conversationId, round, message                                                              |
| `tool_batch_started`           | Before a tool batch executes                      | executionId, conversationId, round, batchId, mode, maxConcurrency, requestCount, tools                   |
| `tool_execution_request`       | For each parsed tool call                         | executionId, conversationId, round, batchId, index, toolName, toolCallId, parameters, ownerPath          |
| `tool_execution_result`        | For each terminal tool result                     | executionId, conversationId, round, batchId, index, toolName, toolCallId, success/result/error, metadata |
| `tool_message_committed`       | Tool result message is committed to history       | executionId, conversationId, round, batchId, index, message                                              |
| `history_mutation`             | A chat message is appended to canonical history   | executionId, conversationId, mutation, index, message                                                    |

`provider_response_raw.responseKind` is `provider-normalized-message` until provider packages add provider-owned SDK-payload capture hooks. This keeps replay validation deterministic without making core depend on concrete provider SDK response types.

### Signal Propagation

AbortSignal flows through: Session -> `robota.run()` -> ExecutionService -> `callProviderWithCache` -> `provider.chat()` -> `streamWithAbort`.

- **ExecutionService**: Checks `signal.aborted` at round loop boundaries. If aborted, the loop exits early and the result includes `interrupted: true`.
- **callProviderWithCache**: Accepts `signal` and passes it to the provider's `chat()` call, enabling mid-request cancellation. When `IAgentConfig.timeout` is set, it also enforces a provider idle timeout that resets on each `onTextDelta` callback and aborts/reports a provider error if no activity arrives before the timeout.
- **executeAndRecordToolCalls**: Passes `signal` to the tool batch context so queued tools are skipped once abort is triggered.
- **streamWithAbort**: Races `iterator.next()` against abort, checks `signal.aborted` before and after each yielded event, and calls `iterator.return()` when an abort stops the stream.
- **AbortError handling**: `AbortError` exceptions thrown by the fetch layer are caught by the execution loop and treated as a clean interruption (not an error).

### Tool Batch Concurrency

When `IToolExecutionBatchContext.mode` is `parallel`, `ToolExecutionService` enforces `maxConcurrency` with bounded worker execution. The batch result preserves one result slot per request in request order, while errors are aggregated after all started or skipped work settles. If `maxConcurrency` is omitted, all requests may run concurrently; if it is less than 1, execution is clamped to one active tool.

### Partial Content Preservation on Abort

When abort occurs during provider streaming, the provider uses `streamWithAbort` which breaks out of the iteration loop on `signal.aborted`. The provider then returns partial content collected so far with `stopReason: 'aborted'`. `executeRound` commits this partial response via `commitAssistant('interrupted')` through the standard single commit path. The execution loop then exits via the `signal.aborted` check in ExecutionService. `robota.run()` always returns normally on abort — it does not throw.

## Structured Output Contract (CORE-015)

`run(input, { output })` returns a schema-validated object instead of a string; `runStream` streams
text deltas as usual and delivers the validated object as the generator's **return value** (read it
from the final `{ done: true, value }` iterator result).

- **Accepted schemas**: a Zod schema (validated via `safeParse`, return typed `z.infer<S>` on the
  `Robota` class surface) or an explicit `IJsonSchemaOutput` wrapper carrying the universal
  JSON-schema subset (validated structurally by `validateAgainstJsonSchema`). Both normalize to
  `IStructuredOutputSpec` — one internal representation (SSOT).
- **Provider mapping**: the schema is forwarded as `IChatOptions.responseFormat =
{ type: 'json_schema', name, schema }`. Providers with a native structured-output surface map it
  natively (OpenAI `response_format.json_schema`, Anthropic `output_config.format`, Gemini
  `responseSchema` + JSON mime type); providers without one ignore it — the core-side enforcement
  loop below is the universal contract either way.
- **Enforcement loop**: the final response text is parsed (`parseStructuredResponseText`, tolerant
  of one fenced json block) and validated core-side on every run. A violation triggers a retry
  turn whose input contains the validation issues plus the schema, bounded by `outputRetries`
  (default 2 retries after the first attempt). Exhaustion throws `StructuredOutputError`
  (`issues`, `attempts`).
- **History**: every attempt — including retry feedback turns — is a real conversation turn
  committed through the standard append-only history path. Structured output never edits history.
- **Tools**: tools may run within a structured turn; validation applies to the final assistant
  text after tool rounds complete.
- **Interface note**: the structured overloads are visible on `Robota` directly; through the
  generic `IAgent` interface `run` remains `Promise<string>`-typed.

## Disposal Contract (CORE-013)

`Robota.destroy()` is **best-effort**: it never rejects for cleanup failures, so
`void agent.destroy()` is always safe to fire-and-forget (a rejection would be an unhandled
rejection that kills the host process on Node 20+). Every cleanup step — module disposal, plugin
event unsubscription, module-registry clear, event-emitter disposal — runs regardless of earlier
failures; each failure is logged and collected into the returned `IDestroyResult`
(`Promise<{ errors: Error[] }>`). State is always reset.

The same convention applies to the other disposal surfaces in the stack (one convention,
applied everywhere): `Session.shutdown()` (agent-session) resolves with step failures recorded to
the session log; `TransportRegistry.stopAll()` (agent-transport / `ITransportRegistryView`) stops
every transport and returns collected errors as `IDestroyResult`. Operation-style closes that a
caller acts on (e.g. background-task `closeTask`) intentionally keep throwing — their errors are
answers, not cleanup noise.

## Run Concurrency Contract (CORE-012)

One `Robota` instance owns one conversation history, so concurrent executions on the same instance
would interleave history writes. The instance therefore serializes runs internally:

- `run()` and `runStream()` share a single FIFO run slot per instance. A call made while another
  run is in flight waits for the earlier run to complete, then executes — callers may fire
  concurrent calls without external locking and still get strictly sequential history
  (`user₁, assistant₁, user₂, assistant₂ …`). The queued run's provider request includes the
  completed earlier exchange.
- `runStream()` acquires the slot when iteration starts and holds it until the stream is fully
  consumed (or the generator is closed early via `return()`/`break`, which releases through the
  same `finally` path). An abandoned, never-consumed generator does not hold the slot because the
  generator body has not started.
- If a queued call's `IRunOptions.signal` is already aborted when its turn arrives, it throws
  `Run aborted while queued behind another run on this instance` without touching the provider or
  history. An abort during an in-flight run keeps the existing abort semantics above (returns
  normally, never throws).
- The queue is per-instance. Cross-instance coordination is out of scope; separate instances remain
  fully concurrent.

This ensures:

- The partial response is saved in conversation history for the next turn
- The model can see what it started saying before interruption
- Tool results from completed tools in earlier rounds are preserved

If the partial response includes tool_use blocks (abort during tool call streaming), the tool execution step runs but skips queued tools via `signal.aborted` check in `IToolExecutionBatchContext`. Completed tools have normal results; skipped tools have `"Execution interrupted by user"` error results. Both are recorded in history.

## Conversation History Principles

- **Append-only**: Messages are only added, never edited or deleted.
- **Read-only**: Consumers read history but do not mutate existing messages.
- **Always committed**: `beginAssistant()` + `commitAssistant()` guarantees an assistant message is always appended, even on abort with empty content.
- **No fallback**: If a message should be in history, it IS in history. No fallback to alternative data sources.
- **Unbounded**: `DEFAULT_MAX_MESSAGES_PER_CONVERSATION = 0` (`src/managers/conversation-history-manager.ts`) means no message cap, backing the append-only guarantee — history is never trimmed by count.

## System Prompt (single source of truth)

The system prompt is the agent's **live instruction state** — not conversation content. The append-only/read-only principles above govern user/assistant/tool messages; they do **not** govern the system prompt, which is replaceable.

- **Single owner**: the top-level `config.systemMessage` is the sole source of the system prompt. There is no `defaultModel.systemMessage`; the system prompt is an agent-level concern, not a model-config field, so `IModelConfig`/`setModel` do not carry it.
- **One head message**: each conversation store holds **exactly one** system message, at the head. `ConversationStore.setSystemPrompt(content)` enforces this — it removes any existing system messages and prepends exactly one at the head.
- **Injected once, then the log is reused**: the system prompt belongs to the session log. `initializeConversationStore` injects it (`setSystemPrompt(config.systemMessage)`) **only when the log has no system message yet** — at session start, or the first turn after resume. On subsequent turns the log is **reused as-is**; the prompt is never re-attached or re-derived per turn. This is the correct model: once a prompt has been sent in a session it is part of that session's record.
- **Live updates reach the model**: `Robota.updateSystemPrompt(content)` updates `config.systemMessage` **and** the live conversation store head **in place**, so the very next provider request carries the change. This is the path that propagates a session's persona, self-verification toggle, and AGENTS.md/CLAUDE.md staleness refresh to the model — a real, infrequent mutation, not a per-turn rewrite. Updating only a config field (without the store head) is insufficient because providers read the system prompt from the messages array, never from a separate config field.
- **Resume semantics**: persisted `system` messages are **not** restored into the log; instead the system prompt is injected fresh from the live `config.systemMessage` on the first turn after resume (a staleness refresh — the rebuilt prompt reflects the current cwd/AGENTS.md/CLAUDE.md and tool inventory). The restored conversation's user/assistant/tool messages are always preserved; restore keys off the presence of conversation content, not the system head (so a system prompt applied before the first turn does not block restore).

## Message Model

`IBaseMessage` is the foundation for all message types in the conversation history.

| Field   | Type            | Required | Description                                        |
| ------- | --------------- | -------- | -------------------------------------------------- |
| `id`    | `string`        | Yes      | UUID identifier, auto-generated via `randomUUID()` |
| `state` | `TMessageState` | Yes      | `'complete' \| 'interrupted'`                      |
| `role`  | `string`        | Yes      | Message role (user, assistant, system, tool)       |

**State rules:**

- Non-assistant messages (user, system, tool) always have `state: 'complete'`.
- Only assistant messages may have `state: 'interrupted'`, indicating the response was aborted by the user before natural completion.

## Message Factories

All message factory functions auto-generate `id` via `randomUUID()` and set `state: 'complete'` by default.

| Factory                  | Role      | Notes                                                    |
| ------------------------ | --------- | -------------------------------------------------------- |
| `createUserMessage`      | user      | Always `state: 'complete'`                               |
| `createAssistantMessage` | assistant | Accepts optional `state` parameter (default: `complete`) |
| `createSystemMessage`    | system    | Always `state: 'complete'`                               |
| `createToolMessage`      | tool      | Always `state: 'complete'`                               |

## ConversationStore Streaming State

`ConversationStore` (renamed from `ConversationSession`) manages pending assistant state during streaming:

| Method                              | Description                                                                                              |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `beginAssistant()`                  | Initializes pending state before provider call. Guarantees commitAssistant has data.                     |
| `appendStreaming(delta)`            | Accumulates streaming text into pending state                                                            |
| `appendToolCall(toolCall)`          | Adds tool call to pending state (deduplicates by id)                                                     |
| `commitAssistant(state, metadata?)` | Commits pending to history. Text is ALWAYS preserved. History is append-only.                            |
| `discardPending()`                  | Clears pending without saving                                                                            |
| `hasPendingAssistant()`             | Checks if streaming is in progress                                                                       |
| `getPendingContent()`               | Returns the accumulated pending text content                                                             |
| `addEntry(entry: IHistoryEntry)`    | Appends a pre-built `IHistoryEntry` to history (used for event entries such as tool summaries).          |
| `getHistory()`                      | Returns the full history as `IHistoryEntry[]`. Each chat message wraps a `TUniversalMessage` via `data`. |

**`commitAssistant` behavior:**

- Text content is ALWAYS preserved — no stripping, even when tool calls are present. Context savings is compaction's job.
- The `state` parameter determines whether the committed message has `state: 'complete'` or `state: 'interrupted'`.
- Single commit path — no branching between normal completion and abort.

## getMessagesForAPI

`getMessagesForAPI()` prepares the conversation history for provider API calls. For interrupted assistant messages (`state: 'interrupted'`), the text is annotated with `[This response was interrupted by the user]` suffix. This allows the model to understand that its previous response was cut short.

## executeRound Streaming Flow

The `executeRound` function manages streaming through `ConversationStore`:

1. `beginAssistant()` initializes pending state before the provider call.
2. The run-scoped `onTextDelta` callback is preferred over provider-level callback state, then wrapped to call `appendStreaming(delta)` on each delta.
3. After the provider returns: tool calls are added via `appendToolCall(toolCall)` without rewriting provider-supplied IDs.
4. `commitAssistant(state, metadata?)` is called with state determined by `signal.aborted` — `'interrupted'` if aborted, `'complete'` otherwise.
5. Single commit path — no branching between normal and abort flows.

### Provider Tool Call ID Ownership

Provider adapters own the `tool_call.id` value. Core treats it as the provider transcript token that links an assistant tool call to the corresponding tool message.

- Core must not branch on provider names, model names, or transport packages.
- Core must preserve provider-supplied tool call IDs in committed assistant `toolCalls` and recorded tool message `toolCallId`.
- Conversation history must not require provider tool call IDs to be unique across the whole conversation. Some OpenAI-compatible providers reuse IDs such as `call_0` in later assistant turns.
- If an internal subsystem needs a globally unique execution/event identifier, it must use an internal ID or owner path and keep the provider `toolCallId` as transcript data.

Regression coverage must include a multi-round execution where the provider returns `call_0` in more than one assistant response and execution preserves both provider IDs without throwing duplicate tool message errors.

### Unavailable Tool Call Handling

Provider adapters must preserve provider-native tool calls and pass them to core, even when the tool name is not registered locally. Core owns the execution decision.

Rules:

- `ToolExecutionService` checks the requested tool name before invoking `IToolManager.executeTool()`.
- If the tool is not registered, core must not execute anything or alias the request to another tool.
- The skipped result is recorded as `success: false` with `metadata.errorCode: "unknown_tool"`, `metadata.requestedTool`, and `metadata.availableTools`.
- The corresponding tool message content must explicitly say that the tool call was not executed because the tool is not registered.
- Skipped unknown tools must not be counted as executed tools in `ICoreExecutionResult.toolsExecuted`.
- `tool_execution_result` replay events must include the same metadata so session logs and transports can explain the skipped call.
- If unavailable tool calls repeat for consecutive model/tool rounds, the loop guard stops normal tool rounds and performs one final provider call without tools. The forced instruction tells the model which tool names were unavailable and that those calls were not executed because they are not registered.
- Provider packages must not implement ad hoc aliases such as `agent` -> `robota_command_agent`; command and tool selection must be corrected by model-visible descriptors, schemas, and the normal tool-result feedback loop.

## Extension Points

| Extension   | Base Class            | Contract                                         |
| ----------- | --------------------- | ------------------------------------------------ |
| AI Provider | `AbstractAIProvider`  | Implement `chat()`, `chatStream()`               |
| Tool        | `AbstractTool`        | Implement `execute()`, provide schema            |
| Plugin      | `AbstractPlugin`      | Override lifecycle hooks                         |
| Module      | `AbstractModule`      | Implement `execute()`                            |
| Executor    | `AbstractExecutor`    | Implement `execute()`, `executeStream()`         |
| Storage     | Per-plugin interfaces | Implement storage adapter (memory, file, remote) |

## Error Taxonomy

All errors extend `RobotaError` with `code`, `category`, and `recoverable` properties:

| Error Class               | Code                   | Category | Recoverable |
| ------------------------- | ---------------------- | -------- | ----------- |
| `ConfigurationError`      | `CONFIGURATION_ERROR`  | user     | no          |
| `ValidationError`         | `VALIDATION_ERROR`     | user     | no          |
| `ProviderError`           | `PROVIDER_ERROR`       | provider | yes         |
| `AuthenticationError`     | `AUTHENTICATION_ERROR` | user     | no          |
| `RateLimitError`          | `RATE_LIMIT_ERROR`     | provider | yes         |
| `NetworkError`            | `NETWORK_ERROR`        | system   | yes         |
| `ToolExecutionError`      | `TOOL_EXECUTION_ERROR` | system   | no          |
| `ModelNotAvailableError`  | `MODEL_NOT_AVAILABLE`  | user     | no          |
| `CircuitBreakerOpenError` | `CIRCUIT_BREAKER_OPEN` | system   | yes         |
| `PluginError`             | `PLUGIN_ERROR`         | system   | no          |
| `StorageError`            | `STORAGE_ERROR`        | system   | yes         |

`ErrorUtils` provides `isRecoverable()`, `getErrorCode()`, `fromUnknown()`, and `wrapProviderError()`.

### Execution Loop Error Handling

The default core execution round limit is 10 model/tool rounds. Callers can override it with `IRunOptions.maxExecutionRounds`, `IExecutionContext.maxExecutionRounds`, or `IAgentConfig.maxExecutionRounds`. Run-scoped values win over config defaults. A value of `0` means the execution loop has no round cap and relies on abort, context-window checks, provider idle timeout, and runtime-level controls to stop runaway execution.

**Identical tool-input guard (`maxSameToolInputs`)**: If the same tool is invoked with byte-identical serialized inputs `N` or more times within a single run, the execution loop throws `AbortError` with message `"Tool '<name>' called with the same inputs <N> times. Aborting to prevent infinite loop."`. The threshold is resolved from (in priority order) `IExecutionContext.maxSameToolInputs`, `IRunOptions.maxSameToolInputs`, `IAgentConfig.maxSameToolInputs`. When undefined, the guard is disabled. Introduced in CORE-001.

When the execution loop ends without a final assistant text message (e.g., due to max round limit or context overflow during tool execution):

1. **Force a final summary call** — inject a synthetic user message requesting the AI to respond with what it has so far, noting what remains incomplete and that the user can follow up. Call `provider.chat()` WITHOUT tools (preventing further tool calls). The system message from config must be included. Use streaming (onTextDelta) if available.
2. **Preserve conversation history** — strip the synthetic user message from history after the provider call completes so it doesn't pollute future turns.
3. **Fallback on empty response** — if the forced call produces no text, return: `"Maximum rounds reached. Partial results available in conversation history."`.
4. **If the forced call throws** — catch the error and return the fallback message without re-throwing.

### Pre-Send Context Check

Before each `provider.chat()` call in the execution loop, token usage is checked against the model's context window limit using `estimateContextTokensFromMessages()` plus the current round's provider usage floor. This is a hard-capacity guard, not the automatic compaction policy. Automatic compaction remains owned by the session layer at its configured threshold. The hard guard stops only when the effective estimate exceeds 95% of the context window and emits a diagnostic assistant message with estimated tokens, max tokens, serialized estimate, provider usage floor, and threshold values so UI layers can explain why the prompt was blocked.

### Provider Error Recovery

If `provider.chat()` throws an error (e.g., API 400 for context too large), `executeRound` catches it and injects an assistant message with the error. This ensures the user always sees a readable error message rather than "No response received." If the entire execution pipeline throws, `ExecutionService.execute()` catches it and returns a graceful error result instead of re-throwing.

### AbstractAIProvider.streamWithAbort

`streamWithAbort()` is a protected async generator on `AbstractAIProvider` that wraps any async iterable with cooperative abort checking. All provider implementations MUST use this method for streaming iteration.

**Mechanism:**

1. Races each source `iterator.next()` against the supplied `AbortSignal`, so a stream waiting for the next provider chunk can settle when aborted.
2. For each event from the source iterable, yields with a `setTimeout(0)` interleave to allow the event loop to process abort signals.
3. Checks `signal.aborted` before yielding and calls `iterator.return()` when abort ends iteration.
4. Providers wrap their SDK stream with `this.streamWithAbort(stream, signal)` in their `chatWithStreaming` implementation.

**Usage pattern (in provider):**

```typescript
for await (const event of this.streamWithAbort(stream, signal)) {
  // process event
}
// After loop: check signal.aborted to determine stopReason
```

This ensures all providers have consistent, low-latency abort responsiveness without duplicating the abort-checking logic.

### Tool Result Context Budget

After the assistant message is committed to history, tool results are added to history one by one. After each addition, the estimated token count (`chars/2`) is checked against 80% of the model's context window.

If exceeded, remaining tool results are replaced with a short context-error message (permission-deny pattern):

```
Error: Context window near capacity. Tool execution result skipped.
```

**Key behavior:**

- Follows the permission-deny pattern — AI receives a mix of normal results and context-error results
- The execution loop does NOT break — it continues to the next provider call so the AI can see the mixed results and respond
- AI autonomously decides how to handle: partial answer from available results, retry with fewer tools, etc.
- Skipped tool results are short error messages (~80 chars), so the next provider call succeeds

**Example flow:**

```
[assistant] text + tool_use(Read, Bash, Glob, Write)
[tool] Read result (normal, context at 75%)
[tool] Bash result (normal, context at 82% → overflow detected)
[tool] Glob: "Error: Context window near capacity. Tool execution result skipped."
[tool] Write: "Error: Context window near capacity. Tool execution result skipped."
→ next provider call succeeds
→ AI responds based on Read and Bash results, notes Glob and Write were skipped
```

**Return value:** `addToolResultsToHistory` returns `IToolResultsOutcome` with `contextOverflowed`, `addedCount`, and `skippedCount`.

### Streaming Round Separator

When the execution loop starts round 2+ (after tool execution), `execution-round.ts` emits `'\n\n'` through the run-scoped `onTextDelta` callback before calling `provider.chat()`, falling back to `provider.onTextDelta` only when no run callback is present. This separates streaming text from different rounds in the CLI, which would otherwise concatenate without line breaks.

## Class Contract Registry

### Interface Implementations

| Interface                         | Implementor                   | Kind                     | Location                                       |
| --------------------------------- | ----------------------------- | ------------------------ | ---------------------------------------------- |
| `IAgent`                          | `AbstractAgent`               | abstract base            | `src/abstracts/abstract-agent.ts`              |
| `IAgent`                          | `Robota`                      | production               | `src/core/robota.ts`                           |
| `IAIProvider`                     | `AbstractAIProvider`          | abstract base            | `src/abstracts/abstract-ai-provider.ts`        |
| `IExecutor`                       | `AbstractExecutor`            | abstract base            | `src/abstracts/abstract-executor.ts`           |
| `IPluginContract`, `IPluginHooks` | `AbstractPlugin`              | abstract base            | `src/abstracts/abstract-plugin.ts`             |
| `IToolWithEventService`           | `AbstractTool`                | abstract base            | `src/abstracts/abstract-tool.ts`               |
| `IModule`, `IModuleHooks`         | `AbstractModule`              | abstract base            | `src/abstracts/abstract-module.ts`             |
| `IWorkflowConverter`              | `AbstractWorkflowConverter`   | abstract base            | `src/abstracts/abstract-workflow-converter.ts` |
| `IWorkflowValidator`              | `AbstractWorkflowValidator`   | abstract base            | `src/abstracts/abstract-workflow-validator.ts` |
| `IEventService`                   | `AbstractEventService`        | abstract base            | `src/event-service/event-service.ts`           |
| `IEventService`                   | `DefaultEventService`         | production (null object) | `src/event-service/event-service.ts`           |
| `IEventService`                   | `StructuredEventService`      | production               | `src/event-service/event-service.ts`           |
| `IEventService`                   | `ObservableEventService`      | production               | `src/event-service/event-service.ts`           |
| `IConversationHistory`            | `ConversationHistory`         | production               | `src/managers/conversation-history-manager.ts` |
| `IConversationHistory`            | `ConversationStore`           | production               | `src/managers/conversation-store.ts`           |
| `IConversationService`            | `ConversationService`         | production               | `src/services/conversation-service/index.ts`   |
| `IToolManager`                    | `Tools`                       | production               | `src/managers/tool-manager.ts`                 |
| `IAIProviderManager`              | `AIProviders`                 | production               | `src/managers/ai-provider-manager.ts`          |
| `IPluginsManager`                 | `Plugins`                     | production               | `src/managers/plugins.ts`                      |
| `ILogger`                         | `ConsoleLogger`               | production               | `src/utils/logger.ts`                          |
| `IEventHistoryModule`             | `EventHistoryModule`          | production               | `src/services/history-module.ts`               |
| `IEventHistoryModule`             | `InMemoryHistoryStore`        | production               | `src/services/in-memory-history-store.ts`      |
| `IEventEmitterMetrics`            | `InMemoryEventEmitterMetrics` | production               | `src/plugins/event-emitter/metrics.ts`         |
| `ICacheStorage`                   | `MemoryCacheStorage`          | production               | `src/services/cache/memory-cache-storage.ts`   |

NOTE: `MCPTool`, `RelayMcpTool` moved to the MCP-tool layer. Plugin storage implementations (ILogStorage, IUsageStorage, IPerformanceStorage, IHistoryStorage, etc.) moved to their respective external plugin packages. agent-core is the single owner (SSOT) of the public `ToolRegistry` / `FunctionTool` classes (`src/tool-registry/`, exported from the barrel and consumed by `tool-manager`; DATA-005); there is no `OpenAPITool` class (only the `IOpenAPIToolConfig` type and the `createOpenAPITool` factory port).

### Inheritance Chains (within agent-core)

| Base                   | Derived                  | Location                              | Notes                    |
| ---------------------- | ------------------------ | ------------------------------------- | ------------------------ |
| `AbstractAgent`        | `Robota`                 | `src/core/robota.ts`                  | Main facade              |
| `AbstractEventService` | `DefaultEventService`    | `src/event-service/event-service.ts`  | Null object              |
| `AbstractEventService` | `StructuredEventService` | `src/event-service/event-service.ts`  | Owner-bound events       |
| `AbstractEventService` | `ObservableEventService` | `src/event-service/event-service.ts`  | RxJS integration         |
| `AbstractExecutor`     | `LocalExecutor`          | `src/executors/local-executor.ts`     | Local provider execution |
| `AbstractPlugin`       | `EventEmitterPlugin`     | `src/plugins/event-emitter-plugin.ts` | Event coordination       |

NOTE: The single `FunctionTool` class (agent-core's `tool-registry`, DATA-005 SSOT) implements `IFunctionTool`/`ITool` directly without extending `AbstractTool`. There is no `OpenAPITool` class; OpenAPI tools are built through the `createOpenAPITool` factory port. Plugin implementations in the external plugin packages extend `AbstractPlugin`.

### Cross-Package Port Consumers

| Port (Owner)                      | Adapter (Consumer Package)                   | Location                                                            |
| --------------------------------- | -------------------------------------------- | ------------------------------------------------------------------- |
| `AbstractAIProvider` (agent-core) | `OpenAIProvider` (agent-provider)            | `packages/agent-provider-openai/src/openai/provider.ts`             |
| `AbstractAIProvider` (agent-core) | `AnthropicProvider` (agent-provider)         | `packages/agent-provider-anthropic/src/anthropic/provider.ts`       |
| `AbstractAIProvider` (agent-core) | `GeminiProvider` (agent-provider)            | `packages/agent-provider-gemini/src/gemini/provider.ts`             |
| `AbstractAIProvider` (agent-core) | `GoogleProvider` (agent-provider)            | `packages/agent-provider-gemini/src/google/provider.ts`             |
| `AbstractAIProvider` (agent-core) | `MockAIProvider` (agent-session)             | `packages/agent-session/examples/verify-offline.ts`                 |
| `IExecutor` (agent-core)          | `SimpleRemoteExecutor` (agent-remote-client) | `packages/agent-remote-client/src/client/remote-executor-simple.ts` |

## Test Strategy

### Test-only fixtures — `@robota-sdk/agent-core/testing` (TEST-003 / TEST-005)

A node-only `./testing` subpath (excluded from the browser build and the runtime bundle) owns the
deterministic test providers (SSOT). It is the lowest layer that can own these fixtures because they
implement only agent-core contracts; higher layers (`agent-framework/testing`,
`agent-transport/testing`) re-export them. Never import from runtime code.

- **Scripted provider** — `createScriptedProvider(turns)` returns an `IAIProvider` that replays
  declared assistant turns (text or tool calls) through the **real** agent loop and records every
  request. Tests the machinery; ignores the prompt.
- **Record-replay (cassette) provider (TEST-005)** — `createRecordingProvider({ provider,
cassettePath, recordCwd? })` wraps a real provider and writes each interaction to a cassette;
  `createReplayProvider({ cassettePath, rewriteCwd? })` replays it deterministically with staleness
  detection (request hash over a workspace-scrubbed projection) and clear exhaustion errors. Lets a
  real model's prompts + tool-use be captured once and replayed in CI at zero per-run cost.

### Current Coverage

| Layer         | Test Files                                                                              | Coverage                                       |
| ------------- | --------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Core (Robota) | `robota.test.ts`                                                                        | Core flow                                      |
| Executors     | `local-executor.test.ts`                                                                | Local execution                                |
| Managers      | `agent-factory.test.ts`, `tool-manager.test.ts`, `conversation-history-manager.test.ts` | Creation, tools, history                       |
| Plugins       | `event-emitter-plugin.test.ts`                                                          | Event coordination                             |
| Providers     | `provider-capabilities.test.ts`                                                         | Default capabilities and native web validation |
| Services      | `event-service.test.ts`, `execution-service.test.ts`                                    | Events, execution                              |

### Scenario Verification

- Command: `pnpm scenario:verify` (runs `examples/verify-offline.ts` with MockAIProvider)
- Record: `examples/scenarios/offline-verify.record.json`
- Validates: agent creation, tool registration, conversation flow without network

### Coverage Gaps (Improvement Targets)

- Service edge cases: tool-execution-service, task-events, user-events
- Utility tests: errors, validation, message-converter
- NOTE: Plugin tests belong to the external plugin packages. Tool tests belong to the tools layer.

## Dependencies

### Production (2)

- `jssha` — SHA hashing for content verification
- `zod` — Schema validation for tool parameters

### Key Peer Contracts

- Provider packages implement `AbstractAIProvider` and `IAIProvider`
- The session layer consumes `Robota`, `runHooks`, `evaluatePermission`, `TUniversalMessage`
- The tools layer consumes `AbstractTool`, `IFunctionTool`, `IToolWithEventService`
- External plugin packages extend `AbstractPlugin`
- **agent-core OWNS the neutral multi-agent orchestration contracts + event-type unions**
  (`src/orchestration/` — `TOrchestrationPrimitive`, `IOrchestrationStep`,
  `ISequentialOrchestrationSpec`, `IOrchestrationRunResult`, `IOrchestrationEventData`,
  `ORCHESTRATION_EVENTS`); **the `agent-framework` layer IMPLEMENTS them** as the mechanism
  over `agent-executor`'s `ISubagentRunner` port (SELFHOST-001). These are pure contracts (no
  runtime, no class) and carry no app-domain identity (neutrality enforced by the standing
  `orchestration-neutrality` harness scan). The multi-agent layer still consumes `Robota`,
  `IAgentConfig`, and the event services for the single-agent runs the primitives compose.
  Extraction trigger (B3): when a second implementer family lands (a dag-\* adapter), both these
  contracts and the event unions move to a new `agent-interface-orchestration` package
  (deps ⊆ {agent-core}).
