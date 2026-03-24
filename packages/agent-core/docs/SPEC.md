# Agents Specification

## Scope

- Owns the core Robota agent runtime, tool integration, conversation execution, and plugin-facing agent behavior.
- Defines the canonical agent orchestration surface used by provider and higher-level packages.
- Provides abstract base classes that provider packages and extensions must implement.

## Boundaries

- Keeps provider-specific transport behavior in provider packages (`@robota-sdk/agent-provider-openai`, `@robota-sdk/agent-provider-anthropic`, `@robota-sdk/agent-provider-google`).
- Keeps package-specific domain contracts owned once and reused through public surfaces.
- Does not own workflow visualization, DAG orchestration, or session persistence (those belong to `dag-*`, `@robota-sdk/agent-sessions`).

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
  │     ├── command-executor.ts     — CommandExecutor: shell command hook execution
  │     ├── http-executor.ts        — HttpExecutor: HTTP request hook execution
  │     └── types.ts                — THookEvent (8 events), IHookDefinition (discriminated union), IHookTypeExecutor
  └── Plugin Layer (1 built-in + 8 external @robota-sdk/agent-plugin-* packages)
        ├── EventEmitterPlugin           (built-in — event coordination)
        └── External plugins (per @robota-sdk/agent-plugin-*):
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

| Type                        | Location                         | Purpose                                                                                                                                                 |
| --------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TUniversalMessage`         | `interfaces/messages.ts`         | Canonical message union (User, Assistant, System, Tool)                                                                                                 |
| `TUniversalMessageMetadata` | `interfaces/messages.ts`         | Message metadata record. Values: `string \| number \| boolean \| Date \| string[] \| number[] \| Record<string, number>` (includes token usage objects) |
| `TUniversalValue`           | `interfaces/types.ts`            | Recursive value type without `any`                                                                                                                      |
| `TMetadata`                 | `interfaces/types.ts`            | Metadata record type                                                                                                                                    |
| `IAgentConfig`              | `interfaces/agent.ts`            | Agent configuration contract                                                                                                                            |
| `IAIProvider`               | `interfaces/provider.ts`         | Provider integration contract                                                                                                                           |
| `IToolSchema`               | `interfaces/provider.ts`         | Tool schema contract                                                                                                                                    |
| `TToolParameters`           | `interfaces/types.ts`            | Tool parameter type (re-exported via `interfaces/tool.ts`)                                                                                              |
| `IEventService`             | `event-service/interfaces.ts`    | Event emission contract                                                                                                                                 |
| `IOwnerPathSegment`         | `event-service/interfaces.ts`    | Execution path tracking                                                                                                                                 |
| `RobotaError`               | `utils/errors.ts`                | Base error hierarchy                                                                                                                                    |
| `TTextDeltaCallback`        | `interfaces/provider.ts`         | Streaming text delta callback `(delta: string) => void`                                                                                                 |
| `TPermissionMode`           | `permissions/types.ts`           | Permission modes: plan, default, acceptEdits, bypassPermissions                                                                                         |
| `TTrustLevel`               | `permissions/types.ts`           | Friendly trust aliases: safe, moderate, full                                                                                                            |
| `TPermissionDecision`       | `permissions/types.ts`           | Evaluation outcome: auto, approve, deny                                                                                                                 |
| `TToolArgs`                 | `permissions/permission-gate.ts` | Tool arguments record for permission matching                                                                                                           |
| `IPermissionLists`          | `permissions/permission-gate.ts` | Allow/deny pattern lists for permission config                                                                                                          |
| `TKnownToolName`            | `permissions/permission-mode.ts` | Known tool names in the permission system                                                                                                               |
| `THookEvent`                | `hooks/types.ts`                 | Hook lifecycle events (8 events): PreToolUse, PostToolUse, PreCompact, PostCompact, SessionStart, Stop, UserPromptSubmit, Notification                  |
| `THooksConfig`              | `hooks/types.ts`                 | Complete hooks configuration: event to hook groups                                                                                                      |
| `IHookGroup`                | `hooks/types.ts`                 | Hook group: matcher pattern + hook definitions                                                                                                          |
| `IHookDefinition`           | `hooks/types.ts`                 | Discriminated union hook definition (type: command, http, prompt, agent)                                                                                |
| `IHookTypeExecutor`         | `hooks/types.ts`                 | Strategy interface for hook type execution                                                                                                              |
| `IHookInput`                | `hooks/types.ts`                 | Input passed to hook commands via stdin                                                                                                                 |
| `IHookResult`               | `hooks/types.ts`                 | Hook execution result (exitCode, stdout, stderr)                                                                                                        |
| `IContextTokenUsage`        | `context/types.ts`               | Token usage from a single API call (input, output, cache tokens)                                                                                        |
| `IContextWindowState`       | `context/types.ts`               | Context window state snapshot (maxTokens, usedTokens, percentage)                                                                                       |

Provider packages import these types. They must not re-declare them.

### Model Definitions (SSOT)

`context/models.ts` is the single source of truth for Claude model metadata. Source: https://platform.claude.com/docs/en/about-claude/models/overview

| Export                      | Kind      | Description                                          |
| --------------------------- | --------- | ---------------------------------------------------- |
| `IModelDefinition`          | Interface | Model metadata: name, id, contextWindow, maxOutput   |
| `CLAUDE_MODELS`             | Record    | All known Claude models (4.5+) keyed by API ID       |
| `DEFAULT_CONTEXT_WINDOW`    | Constant  | 200,000 tokens fallback                              |
| `getModelContextWindow(id)` | Function  | Get context window size for a model ID               |
| `getModelName(id)`          | Function  | Get human-readable name (e.g., "Claude Sonnet 4.6")  |
| `formatTokenCount(tokens)`  | Function  | Format tokens as human-readable (e.g., "200K", "1M") |

## Public API Surface

### Core

| Export               | Kind           | Description                       |
| -------------------- | -------------- | --------------------------------- |
| `Robota`             | class          | Main agent facade                 |
| `AbstractAgent`      | abstract class | Base agent lifecycle              |
| `AbstractAIProvider` | abstract class | Base for provider implementations |
| `AbstractPlugin`     | abstract class | Base for plugin extensions        |
| `AbstractTool`       | abstract class | Base for tool implementations     |
| `AbstractExecutor`   | abstract class | Base for execution strategies     |
| `LocalExecutor`      | class          | Local provider execution          |

### Tools

NOTE: `ToolRegistry`, `FunctionTool`, `createFunctionTool`, `createZodFunctionTool`, and `OpenAPITool` have been moved to `@robota-sdk/agent-tools`. `MCPTool` and `RelayMcpTool` have been moved to `@robota-sdk/agent-tool-mcp`.

### Permissions

| Export                  | Kind     | Description                                                   |
| ----------------------- | -------- | ------------------------------------------------------------- |
| `evaluatePermission`    | function | 3-step deterministic policy: deny list, allow list, mode      |
| `MODE_POLICY`           | const    | Permission mode to tool decision matrix                       |
| `TRUST_TO_MODE`         | const    | Maps TTrustLevel to TPermissionMode                           |
| `UNKNOWN_TOOL_FALLBACK` | const    | Fallback decisions for unknown tools per mode                 |
| `TPermissionMode`       | type     | `'plan' \| 'default' \| 'acceptEdits' \| 'bypassPermissions'` |
| `TTrustLevel`           | type     | `'safe' \| 'moderate' \| 'full'`                              |
| `TPermissionDecision`   | type     | `'auto' \| 'approve' \| 'deny'`                               |
| `TToolArgs`             | type     | Tool arguments record for permission matching                 |
| `IPermissionLists`      | type     | Allow/deny pattern lists                                      |
| `TKnownToolName`        | type     | Known tool names: Bash, Read, Write, Edit, Glob, Grep         |

### Hooks

| Export              | Kind      | Description                                                                                                    |
| ------------------- | --------- | -------------------------------------------------------------------------------------------------------------- |
| `runHooks`          | function  | Execute hooks for lifecycle events using pluggable type executors                                              |
| `THookEvent`        | type      | 8 events: PreToolUse, PostToolUse, SessionStart, Stop, PreCompact, PostCompact, UserPromptSubmit, Notification |
| `THooksConfig`      | type      | Event to hook group array mapping                                                                              |
| `IHookGroup`        | type      | Matcher pattern + hook definitions                                                                             |
| `IHookDefinition`   | type      | Discriminated union: command, http, prompt, agent hook types                                                   |
| `IHookTypeExecutor` | interface | Strategy interface for executing a specific hook type                                                          |
| `CommandExecutor`   | class     | Built-in executor for `command` type hooks (shell execution)                                                   |
| `HttpExecutor`      | class     | Built-in executor for `http` type hooks (HTTP request)                                                         |
| `IHookInput`        | type      | JSON input passed to hooks via stdin                                                                           |
| `IHookResult`       | type      | Hook result: exitCode (0=allow, 2=block), stdout, stderr                                                       |

### Streaming

| Export               | Kind | Description                                         |
| -------------------- | ---- | --------------------------------------------------- |
| `TTextDeltaCallback` | type | `(delta: string) => void` — streaming text callback |

This callback is declared in `IChatOptions.onTextDelta` and used by providers to emit text chunks during streaming responses.

### Context Window Tracking

| Export                | Kind      | Description                                                           |
| --------------------- | --------- | --------------------------------------------------------------------- |
| `IContextTokenUsage`  | interface | Token usage from a single API call (inputTokens, outputTokens, cache) |
| `IContextWindowState` | interface | Context window state snapshot (maxTokens, usedTokens, usedPercentage) |

These types are consumed by `@robota-sdk/agent-sessions` to track cumulative token usage and context window state across conversation turns.

### Managers

| Export                | Kind  | Description                   |
| --------------------- | ----- | ----------------------------- |
| `AgentFactory`        | class | Agent creation and lifecycle  |
| `AgentTemplates`      | class | Template-based agent creation |
| `ConversationHistory` | class | History management            |
| `ConversationSession` | class | Session management            |

### Services

| Export                   | Kind           | Description         |
| ------------------------ | -------------- | ------------------- |
| `AbstractEventService`   | abstract class | Event system base   |
| `DefaultEventService`    | class          | No-op event service |
| `StructuredEventService` | class          | Owner-bound events  |
| `ObservableEventService` | class          | RxJS integration    |
| `EventHistoryModule`     | class          | Event recording     |

### Plugins (1 built-in)

| Plugin               | Category         | Description        |
| -------------------- | ---------------- | ------------------ |
| `EventEmitterPlugin` | event_processing | Event coordination |

8 plugins were extracted to `@robota-sdk/agent-plugin-*` packages to comply with the agent-core zero-dependency rule. They extend `AbstractPlugin` (defined here) and are wired by the consuming layer.

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

The permission module (`src/permissions/`) provides a deterministic, three-step policy evaluation for tool calls. It is consumed by `@robota-sdk/agent-sessions` to gate tool execution before delegating to the actual tool.

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
| `Stop`             | Session termination       | Cleanup, reporting                               |
| `PreCompact`       | Before context compaction | Validation, logging (trigger: auto/manual)       |
| `PostCompact`      | After context compaction  | Logging, notification (includes compact_summary) |
| `UserPromptSubmit` | After user submits prompt | Pre-processing, validation, prompt rewriting     |
| `Notification`     | On notable events         | External notification (Slack, email, etc.)       |

### Hook Definition Types (Discriminated Union)

`IHookDefinition` is a discriminated union on the `type` field:

| Type      | Fields                               | Description                                      |
| --------- | ------------------------------------ | ------------------------------------------------ |
| `command` | `command: string`                    | Shell command execution (stdin JSON, exit codes) |
| `http`    | `url: string`, `method?`, `headers?` | HTTP request to an external endpoint             |
| `prompt`  | `prompt: string`                     | LLM prompt injection into session context        |
| `agent`   | `agent: string`, `config?`           | Delegate to a sub-agent for processing           |

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

**Extended executors (agent-sdk):**

| Executor         | Hook Type | Behavior                                                |
| ---------------- | --------- | ------------------------------------------------------- |
| `PromptExecutor` | `prompt`  | Injects prompt text into session context                |
| `AgentExecutor`  | `agent`   | Delegates to a sub-agent session for complex processing |

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

| Interface                    | Field                   | Description                                                       |
| ---------------------------- | ----------------------- | ----------------------------------------------------------------- |
| `IRunOptions`                | `signal?: AbortSignal`  | Allows callers to cancel execution of `Robota.run()`              |
| `IChatOptions`               | `signal?: AbortSignal`  | Passed to provider `chat()` / `chatStream()` for cancelling calls |
| `IExecutionContext`          | `signal?: AbortSignal`  | Threaded through the execution context for round-level checks     |
| `IExecutionResult`           | `interrupted?: boolean` | Indicates the execution was aborted before natural completion     |
| `IToolExecutionBatchContext` | `signal?: AbortSignal`  | Allows skipping queued tool executions when abort is signalled    |

### Execution Flow

- **ExecutionService**: Checks `signal.aborted` at round loop boundaries. If aborted, the loop exits early and the result includes `interrupted: true`.
- **callProviderWithCache**: Accepts `signal` and passes it to the provider's `chat()` call, enabling mid-request cancellation.
- **executeAndRecordToolCalls**: Passes `signal` to the tool batch context so queued tools are skipped once abort is triggered.
- **AbortError handling**: `AbortError` exceptions thrown by the provider or fetch layer are caught by the execution loop and treated as a clean interruption (not an error).

### Partial Content Preservation on Abort

When abort occurs during provider streaming, the provider catches AbortError internally and returns partial content collected so far as a normal response. `executeRound` processes this partial response through the standard path (`addAssistantMessage`) with `metadata.interrupted = true`. The execution loop then exits via the `signal.aborted` check in ExecutionService. `robota.run()` always returns normally on abort — it does not throw.

This ensures:

- The partial response is saved in conversation history for the next turn
- The model can see what it started saying before interruption
- Tool results from completed tools in earlier rounds are preserved

If the partial response includes tool_use blocks (abort during tool call streaming), the tool execution step runs but skips queued tools via `signal.aborted` check in `IToolExecutionBatchContext`. Completed tools have normal results; skipped tools have `"Execution interrupted by user"` error results. Both are recorded in history.

The `executeRound` catch block for AbortError (re-throw path) is a fallback for providers that throw AbortError instead of returning partial content. The Anthropic provider always returns normally on abort.

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

## ConversationSession Streaming State

`ConversationSession` manages pending assistant state during streaming:

| Method                              | Description                                                                                        |
| ----------------------------------- | -------------------------------------------------------------------------------------------------- |
| `appendStreaming(delta)`            | Accumulates streaming text, creates pending state with UUID                                        |
| `appendToolCall(toolCall)`          | Adds tool call to pending state (deduplicates by id)                                               |
| `commitAssistant(state, metadata?)` | Commits pending to history. Strips text when tool calls present. Single path for normal and abort. |
| `discardPending()`                  | Clears pending without saving                                                                      |
| `hasPendingAssistant()`             | Checks if streaming is in progress                                                                 |

**`commitAssistant` behavior:**

- When tool calls are present, text content is stripped (set to `""`) — consistent with the assistant text stripping rule.
- The `state` parameter determines whether the committed message has `state: 'complete'` or `state: 'interrupted'`.
- Single commit path — no branching between normal completion and abort.

## getMessagesForAPI

`getMessagesForAPI()` prepares the conversation history for provider API calls. For interrupted assistant messages (`state: 'interrupted'`), the text is annotated with `[This response was interrupted by the user]` suffix. This allows the model to understand that its previous response was cut short.

## executeRound Streaming Flow

The `executeRound` function manages streaming through `ConversationSession`:

1. Provider's `onTextDelta` callback is wrapped to call `appendStreaming(delta)` on each delta.
2. After the provider returns: tool calls are extracted via `appendToolCall(toolCall)`.
3. `commitAssistant(state, metadata?)` is called with state determined by `signal.aborted` — `'interrupted'` if aborted, `'complete'` otherwise.
4. Single commit path — no branching between normal and abort flows.

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

When the execution loop ends without a final assistant text message (e.g., due to max round limit or context overflow during tool execution):

1. **Force a final summary call** — inject a synthetic user message requesting the AI to respond with what it has so far, noting what remains incomplete and that the user can follow up. Call `provider.chat()` WITHOUT tools (preventing further tool calls). The system message from config must be included. Use streaming (onTextDelta) if available.
2. **Preserve conversation history** — strip the synthetic user message from history after the provider call completes so it doesn't pollute future turns.
3. **Fallback on empty response** — if the forced call produces no text, return: `"Maximum rounds reached. Partial results available in conversation history."`.
4. **If the forced call throws** — catch the error and return the fallback message without re-throwing.

### Pre-Send Context Check

Before each `provider.chat()` call in the execution loop, token usage is checked against the model's context window limit. The estimate uses `Math.max(cumulativeInputTokens, chars/2)` — the higher of the API-reported token count and the character-based estimate. `chars/2` (not `chars/3`) is used because Korean text, JSON, and code content have a higher char-to-token ratio. If usage exceeds 83.5% of the context window, the execution loop stops early with a clear assistant message prompting the user to `/compact`.

### Provider Error Recovery

If `provider.chat()` throws an error (e.g., API 400 for context too large), `executeRound` catches it and injects an assistant message with the error. This ensures the user always sees a readable error message rather than "No response received." If the entire execution pipeline throws, `ExecutionService.execute()` catches it and returns a graceful error result instead of re-throwing.

### Assistant Text Stripping for Tool Rounds

When the AI responds with **text + tool_use blocks**, the text content is stripped from the assistant message in conversation history. Only the tool_use blocks are preserved.

**Rationale:**

- The text is already displayed to the user via streaming (`onTextDelta`) — its display purpose is fulfilled
- The text is typically intent description ("I'll check those files"), not analysis results
- The AI can reconstruct intent from the tool_use blocks and their arguments
- Stripping frees context budget for tool results, which carry the actual information
- Prevents the edge case where assistant text alone fills context, leaving no room for any tool results

**Rule:** `tool_use blocks present → text content set to ""`. No exceptions.

**Final responses** (no tool_use blocks) preserve text as-is — this is the actual answer to the user.

### Tool Result Context Budget

After the assistant message is recorded (text stripped if tool_use present), tool results are added to history one by one. After each addition, the estimated token count (`chars/2`) is checked against 80% of the model's context window.

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
[assistant] tool_use(Read, Bash, Glob, Write)    ← text stripped, tool_use only
[tool] Read result (normal, context at 75%)
[tool] Bash result (normal, context at 82% → overflow detected)
[tool] Glob: "Error: Context window near capacity. Tool execution result skipped."
[tool] Write: "Error: Context window near capacity. Tool execution result skipped."
→ next provider call succeeds
→ AI responds based on Read and Bash results, notes Glob and Write were skipped
```

**Return value:** `addToolResultsToHistory` returns `IToolResultsOutcome` with `contextOverflowed`, `addedCount`, and `skippedCount`.

### Streaming Round Separator

When the execution loop starts round 2+ (after tool execution), `execution-round.ts` emits `'\n\n'` through `provider.onTextDelta` before calling `provider.chat()`. This separates streaming text from different rounds in the CLI, which would otherwise concatenate without line breaks.

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
| `IConversationHistory`            | `ConversationSession`         | production               | `src/managers/conversation-session.ts`         |
| `IConversationService`            | `ConversationService`         | production               | `src/services/conversation-service/index.ts`   |
| `IToolManager`                    | `Tools`                       | production               | `src/managers/tool-manager.ts`                 |
| `IAIProviderManager`              | `AIProviders`                 | production               | `src/managers/ai-provider-manager.ts`          |
| `IPluginsManager`                 | `Plugins`                     | production               | `src/managers/plugins.ts`                      |
| `ILogger`                         | `ConsoleLogger`               | production               | `src/utils/logger.ts`                          |
| `IEventHistoryModule`             | `EventHistoryModule`          | production               | `src/services/history-module.ts`               |
| `IEventHistoryModule`             | `InMemoryHistoryStore`        | production               | `src/services/in-memory-history-store.ts`      |
| `IEventEmitterMetrics`            | `InMemoryEventEmitterMetrics` | production               | `src/plugins/event-emitter/metrics.ts`         |
| `ICacheStorage`                   | `MemoryCacheStorage`          | production               | `src/services/cache/memory-cache-storage.ts`   |

NOTE: `FunctionTool`, `ToolRegistry`, `OpenAPITool` moved to `@robota-sdk/agent-tools`. `MCPTool`, `RelayMcpTool` moved to `@robota-sdk/agent-tool-mcp`. Plugin storage implementations (ILogStorage, IUsageStorage, IPerformanceStorage, IHistoryStorage, etc.) moved to their respective `@robota-sdk/agent-plugin-*` packages.

### Inheritance Chains (within agent-core)

| Base                   | Derived                  | Location                              | Notes                    |
| ---------------------- | ------------------------ | ------------------------------------- | ------------------------ |
| `AbstractAgent`        | `Robota`                 | `src/core/robota.ts`                  | Main facade              |
| `AbstractEventService` | `DefaultEventService`    | `src/event-service/event-service.ts`  | Null object              |
| `AbstractEventService` | `StructuredEventService` | `src/event-service/event-service.ts`  | Owner-bound events       |
| `AbstractEventService` | `ObservableEventService` | `src/event-service/event-service.ts`  | RxJS integration         |
| `AbstractExecutor`     | `LocalExecutor`          | `src/executors/local-executor.ts`     | Local provider execution |
| `AbstractPlugin`       | `EventEmitterPlugin`     | `src/plugins/event-emitter-plugin.ts` | Event coordination       |

NOTE: Tool implementations (`FunctionTool`, `OpenAPITool`) in `@robota-sdk/agent-tools` implement `IFunctionTool`/`ITool` directly without extending `AbstractTool`. Plugin implementations in `@robota-sdk/agent-plugin-*` extend `AbstractPlugin`.

### Cross-Package Port Consumers

| Port (Owner)                      | Adapter (Consumer Package)                     | Location                                                     |
| --------------------------------- | ---------------------------------------------- | ------------------------------------------------------------ |
| `AbstractAIProvider` (agent-core) | `OpenAIProvider` (agent-provider-openai)       | `packages/agent-provider-openai/src/provider.ts`             |
| `AbstractAIProvider` (agent-core) | `AnthropicProvider` (agent-provider-anthropic) | `packages/agent-provider-anthropic/src/provider.ts`          |
| `AbstractAIProvider` (agent-core) | `GoogleProvider` (agent-provider-google)       | `packages/agent-provider-google/src/provider.ts`             |
| `AbstractAIProvider` (agent-core) | `MockAIProvider` (agent-sessions)              | `packages/agent-sessions/examples/verify-offline.ts`         |
| `AbstractExecutor` (agent-core)   | `SimpleRemoteExecutor` (agent-remote)          | `packages/agent-remote/src/client/remote-executor-simple.ts` |

## Test Strategy

### Current Coverage

| Layer         | Test Files                                                                              | Coverage                 |
| ------------- | --------------------------------------------------------------------------------------- | ------------------------ |
| Core (Robota) | `robota.test.ts`                                                                        | Core flow                |
| Executors     | `local-executor.test.ts`                                                                | Local execution          |
| Managers      | `agent-factory.test.ts`, `tool-manager.test.ts`, `conversation-history-manager.test.ts` | Creation, tools, history |
| Plugins       | `event-emitter-plugin.test.ts`                                                          | Event coordination       |
| Services      | `event-service.test.ts`, `execution-service.test.ts`                                    | Events, execution        |

### Scenario Verification

- Command: `pnpm scenario:verify` (runs `examples/verify-offline.ts` with MockAIProvider)
- Record: `examples/scenarios/offline-verify.record.json`
- Validates: agent creation, tool registration, conversation flow without network

### Coverage Gaps (Improvement Targets)

- Service edge cases: tool-execution-service, task-events, user-events
- Utility tests: errors, validation, message-converter
- NOTE: Plugin tests belong to `@robota-sdk/agent-plugin-*` packages. Tool tests belong to `@robota-sdk/agent-tools`.

## Dependencies

### Production (2)

- `jssha` — SHA hashing for content verification
- `zod` — Schema validation for tool parameters

### Key Peer Contracts

- Provider packages implement `AbstractAIProvider` and `IAIProvider`
- `@robota-sdk/agent-sessions` consumes `Robota`, `runHooks`, `evaluatePermission`, `TUniversalMessage`
- `@robota-sdk/agent-tools` consumes `AbstractTool`, `IFunctionTool`, `IToolWithEventService`
- `@robota-sdk/agent-plugin-*` packages extend `AbstractPlugin`
- `@robota-sdk/agent-team` consumes `Robota`, `IAgentConfig`, event services
