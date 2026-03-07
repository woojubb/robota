# Agents Specification

## Scope

- Owns the core Robota agent runtime, tool integration, conversation execution, and plugin-facing agent behavior.
- Defines the canonical agent orchestration surface used by provider and higher-level packages.
- Provides abstract base classes that provider packages and extensions must implement.

## Boundaries

- Keeps provider-specific transport behavior in provider packages (`@robota-sdk/openai`, `@robota-sdk/anthropic`, `@robota-sdk/google`).
- Keeps package-specific domain contracts owned once and reused through public surfaces.
- Does not own workflow visualization, DAG orchestration, or session persistence (those belong to `workflow`, `dag-*`, `sessions`).

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
  └── Plugin Layer (10 built-in plugins)
        ├── ConversationHistoryPlugin
        ├── LoggingPlugin
        ├── UsagePlugin
        ├── PerformancePlugin
        ├── ExecutionPlugin
        ├── ErrorHandlingPlugin
        ├── LimitsPlugin
        ├── EventEmitterPlugin
        └── WebhookPlugin
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

| Type | Location | Purpose |
|------|----------|---------|
| `TUniversalMessage` | `interfaces/messages.ts` | Canonical message union (User, Assistant, System, Tool) |
| `TUniversalValue` | `interfaces/types.ts` | Recursive value type without `any` |
| `TMetadata` | `interfaces/types.ts` | Metadata record type |
| `IAgentConfig` | `interfaces/agent.ts` | Agent configuration contract |
| `IAIProvider` | `interfaces/provider.ts` | Provider integration contract |
| `IToolSchema` | `interfaces/provider.ts` | Tool schema contract |
| `TToolParameters` | `interfaces/tool.ts` | Tool parameter type |
| `IEventService` | `services/event-service.ts` | Event emission contract |
| `IOwnerPathSegment` | `services/event-service.ts` | Execution path tracking |
| `RobotaError` | `utils/errors.ts` | Base error hierarchy |

Provider packages import these types. They must not re-declare them.

## Public API Surface

### Core

| Export | Kind | Description |
|--------|------|-------------|
| `Robota` | class | Main agent facade |
| `AbstractAgent` | abstract class | Base agent lifecycle |
| `AbstractAIProvider` | abstract class | Base for provider implementations |
| `AbstractPlugin` | abstract class | Base for plugin extensions |
| `AbstractTool` | abstract class | Base for tool implementations |
| `AbstractExecutor` | abstract class | Base for execution strategies |
| `LocalExecutor` | class | Local provider execution |

### Tools

| Export | Kind | Description |
|--------|------|-------------|
| `FunctionTool` | class | JS function with Zod schema |
| `createFunctionTool` | function | Factory for function tools |
| `createZodFunctionTool` | function | Factory with Zod validation |
| `ToolRegistry` | class | Central tool management |
| `RelayMcpTool` | class | MCP relay tool |

### Managers

| Export | Kind | Description |
|--------|------|-------------|
| `AgentFactory` | class | Agent creation and lifecycle |
| `AgentTemplates` | class | Template-based agent creation |
| `ConversationHistory` | class | History management |
| `ConversationSession` | class | Session management |

### Services

| Export | Kind | Description |
|--------|------|-------------|
| `AbstractEventService` | abstract class | Event system base |
| `DefaultEventService` | class | No-op event service |
| `StructuredEventService` | class | Owner-bound events |
| `ObservableEventService` | class | RxJS integration |
| `EventHistoryModule` | class | Event recording |

### Plugins (10 built-in)

| Plugin | Category | Description |
|--------|----------|-------------|
| `ConversationHistoryPlugin` | storage | Persistent history (memory, file, database, remote) |
| `LoggingPlugin` | logging | Multi-backend logging (console, file, remote, silent) |
| `UsagePlugin` | monitoring | Token usage and cost tracking |
| `PerformancePlugin` | monitoring | Metrics collection |
| `ExecutionPlugin` | monitoring | Execution analytics |
| `ErrorHandlingPlugin` | error_handling | Error recovery strategies |
| `LimitsPlugin` | limits | Rate limiting |
| `EventEmitterPlugin` | event_processing | Event coordination |
| `WebhookPlugin` | notification | External HTTP notifications |

## Plugin Contract

Plugins extend `AbstractPlugin` and implement lifecycle hooks:

| Hook | Timing | Purpose |
|------|--------|---------|
| `beforeRun` | Before LLM call | Input transformation, validation |
| `afterRun` | After LLM response | Output processing, recording |
| `onError` | On execution error | Error handling, recovery |
| `onStreamChunk` | During streaming | Chunk processing |
| `beforeToolExecution` | Before tool call | Tool input validation |
| `afterToolExecution` | After tool result | Tool output processing |

Plugins declare `category` (PluginCategory) and `priority` (PluginPriority) for execution ordering.

## Event Architecture

### Event Naming

Full event names follow the pattern `ownerType.localName`:

| Prefix | Owner | Examples |
|--------|-------|---------|
| `execution.*` | ExecutionService | `execution.start`, `execution.complete` |
| `tool.*` | ToolExecutionService | `tool.execute_start`, `tool.execute_success` |
| `agent.*` | Robota | `agent.completion`, `agent.created` |
| `task.*` | Task system | `task.started`, `task.completed` |
| `user.*` | User actions | `user.input` |

### Owner Path Tracking

Each event carries an `ownerPath` array of `IOwnerPathSegment` objects that traces the execution hierarchy:

```typescript
interface IOwnerPathSegment {
    ownerType: string;  // 'agent' | 'tool' | 'execution'
    ownerId: string;
}
```

Events are bound to their owner via `bindWithOwnerPath()`.

## Extension Points

| Extension | Base Class | Contract |
|-----------|-----------|---------|
| AI Provider | `AbstractAIProvider` | Implement `chat()`, `chatStream()` |
| Tool | `AbstractTool` | Implement `execute()`, provide schema |
| Plugin | `AbstractPlugin` | Override lifecycle hooks |
| Module | `AbstractModule` | Implement `execute()` |
| Executor | `AbstractExecutor` | Implement `execute()`, `executeStream()` |
| Storage | Per-plugin interfaces | Implement storage adapter (memory, file, remote) |

## Error Taxonomy

All errors extend `RobotaError` with `code`, `category`, and `recoverable` properties:

| Error Class | Code | Category | Recoverable |
|-------------|------|----------|-------------|
| `ConfigurationError` | `CONFIGURATION_ERROR` | user | no |
| `ValidationError` | `VALIDATION_ERROR` | user | no |
| `ProviderError` | `PROVIDER_ERROR` | provider | yes |
| `AuthenticationError` | `AUTHENTICATION_ERROR` | user | no |
| `RateLimitError` | `RATE_LIMIT_ERROR` | provider | yes |
| `NetworkError` | `NETWORK_ERROR` | system | yes |
| `ToolExecutionError` | `TOOL_EXECUTION_ERROR` | system | no |
| `ModelNotAvailableError` | `MODEL_NOT_AVAILABLE` | user | no |
| `CircuitBreakerOpenError` | `CIRCUIT_BREAKER_OPEN` | system | yes |
| `PluginError` | `PLUGIN_ERROR` | system | no |
| `StorageError` | `STORAGE_ERROR` | system | yes |

`ErrorUtils` provides `isRecoverable()`, `getErrorCode()`, `fromUnknown()`, and `wrapProviderError()`.

## Test Strategy

### Current Coverage

| Layer | Test Files | Coverage |
|-------|-----------|----------|
| Core (Robota) | `robota.test.ts` | Core flow |
| Executors | `local-executor.test.ts` | Local execution |
| Managers | `agent-factory.test.ts`, `tool-manager.test.ts`, `conversation-history-manager.test.ts` | Creation, tools, history |
| Plugins | `event-emitter-plugin.test.ts` | Event coordination |
| Services | `event-service.test.ts`, `execution-service.test.ts` | Events, execution |

### Scenario Verification

- Command: `pnpm scenario:verify` (runs `examples/verify-offline.ts` with MockAIProvider)
- Record: `examples/scenarios/offline-verify.record.json`
- Validates: agent creation, tool registration, conversation flow without network

### Coverage Gaps (Improvement Targets)

- Plugin tests: logging, usage, performance, webhook, limits, error-handling, conversation-history
- Tool implementation tests: function-tool schema conversion, mcp-tool, openapi-tool
- Service edge cases: tool-execution-service, task-events, user-events
- Utility tests: errors, validation, message-converter

## Dependencies

### Production (2)

- `jssha` — SHA hashing for content verification
- `zod` — Schema validation for tool parameters

### Key Peer Contracts

- Provider packages implement `AbstractAIProvider` and `IAIProvider`
- `@robota-sdk/sessions` consumes `ConversationHistory` and `TUniversalMessage`
- `@robota-sdk/team` consumes `Robota`, `IAgentConfig`, event services
