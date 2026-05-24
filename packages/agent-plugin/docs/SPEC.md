# @robota-sdk/agent-plugin — Package Specification

## Scope

`@robota-sdk/agent-plugin` owns the 8 official plugin implementations for the Robota SDK.
Each plugin implements the `IPlugin` interface from `@robota-sdk/agent-core` and encapsulates a
single cross-cutting concern (history, logging, usage, limits, error handling, analytics,
performance, webhooks). This package does not own the plugin host, event bus, or any provider or
tool infrastructure.

## Boundaries

| Responsibility                       | Owner                         |
| ------------------------------------ | ----------------------------- |
| Plugin host and lifecycle management | `@robota-sdk/agent-core`      |
| `IPlugin` / `AbstractPlugin` base    | `@robota-sdk/agent-core`      |
| Provider calls and tool execution    | `@robota-sdk/agent-framework` |
| Session and conversation runtime     | `@robota-sdk/agent-session`   |
| Tool definitions and registry        | `@robota-sdk/agent-tools`     |
| Custom application plugins           | Consumer packages             |

`agent-plugin` depends exclusively on `agent-core`. It must never import from
`agent-framework`, `agent-session`, or `agent-tools`.

## Architecture Overview

### Layer Position

```
agent-core ← agent-plugin (each submodule independently)
```

### Submodule Structure

Each plugin lives in its own directory under `src/` and is independently tree-shakeable.
Sub-modules must not import from each other. Shared internal helpers do not yet exist; if
introduced they belong in `src/shared/`.

```
src/
├── index.ts                     # Root re-export of all plugins
├── conversation-history/        # ConversationHistoryPlugin + 3 storage backends
├── error-handling/              # ErrorHandlingPlugin + context adapter
├── execution-analytics/         # ExecutionAnalyticsPlugin + aggregation helper
├── limits/                      # LimitsPlugin + validation
├── logging/                     # LoggingPlugin + 4 storage backends + formatters
├── performance/                 # PerformancePlugin + memory storage + system metrics
├── usage/                       # UsagePlugin + 4 storage backends + aggregation helper
└── webhook/                     # WebhookPlugin + HTTP client + transformer + queue
```

### Design Patterns

- **Strategy pattern** — storage and rate-limiting algorithms are injected via option objects
  (`storage`, `strategy`) rather than subclassing.
- **Facade pattern** — `WebhookPlugin` and `ErrorHandlingPlugin` coordinate multiple internal
  components behind a single class interface.
- **Periodic task** — `ConversationHistoryPlugin` and `UsagePlugin` use `startPeriodicTask` /
  `stopPeriodicTask` from `agent-core` for timer-based batch flushing.

### Storage Strategy Notes

`PerformancePlugin` declares `TPerformanceMonitoringStrategy` with values
`'memory' | 'file' | 'prometheus' | 'remote' | 'silent'`, but only the `memory` backend is
currently implemented. The other strategy values are reserved for future use.

## Type Ownership

All types below are defined in `@robota-sdk/agent-plugin` and re-exported from `src/index.ts`.

| Type                                | Location                        | Purpose                                 |
| ----------------------------------- | ------------------------------- | --------------------------------------- |
| `THistoryStorageStrategy`           | `conversation-history/types.ts` | Union for storage selection             |
| `IConversationHistoryPluginOptions` | `conversation-history/types.ts` | Plugin config                           |
| `IConversationHistoryEntry`         | `conversation-history/types.ts` | Persisted conversation record           |
| `IHistoryStorage`                   | `conversation-history/types.ts` | Storage backend contract                |
| `IConversationHistoryPluginStats`   | `conversation-history/types.ts` | Plugin stats shape                      |
| `TErrorHandlingStrategy`            | `error-handling/types.ts`       | Union for error strategies              |
| `IErrorHandlingPluginOptions`       | `error-handling/types.ts`       | Plugin config                           |
| `IErrorHandlingContextData`         | `error-handling/types.ts`       | Error context passed to handlers        |
| `IErrorHandlingPluginStats`         | `error-handling/types.ts`       | Plugin stats shape                      |
| `IErrorContextAdapter`              | `error-handling/types.ts`       | Adapter for PluginError context compat  |
| `IExecutionAnalyticsContextData`    | `execution-analytics/types.ts`  | Hook context data shape                 |
| `IExecutionStats`                   | `execution-analytics/types.ts`  | Single execution record                 |
| `IAggregatedExecutionStats`         | `execution-analytics/types.ts`  | Aggregated execution stats              |
| `IExecutionAnalyticsOptions`        | `execution-analytics/types.ts`  | Plugin config                           |
| `IExecutionAnalyticsPluginStats`    | `execution-analytics/types.ts`  | Plugin stats shape                      |
| `TLimitsStrategy`                   | `limits/types.ts`               | Union for rate-limiting algorithms      |
| `ILimitsPluginOptions`              | `limits/types.ts`               | Plugin config                           |
| `TPluginLimitsStatusData`           | `limits/types.ts`               | Status data record type                 |
| `ILimitWindow`                      | `limits/types.ts`               | Sliding/fixed window state              |
| `ITokenBucket`                      | `limits/types.ts`               | Token bucket state                      |
| `TLoggingStrategy`                  | `logging/types.ts`              | Union for log backends                  |
| `TLogLevel`                         | `logging/types.ts`              | Log severity levels                     |
| `ILogEntry`                         | `logging/types.ts`              | Structured log record                   |
| `ILoggingPluginOptions`             | `logging/types.ts`              | Plugin config                           |
| `ILogFormatter`                     | `logging/types.ts`              | Formatter interface for log entries     |
| `ILogStorage`                       | `logging/types.ts`              | Storage backend contract                |
| `ILoggingContextData`               | `logging/types.ts`              | Structured context data for log entries |
| `ILoggingPluginStats`               | `logging/types.ts`              | Plugin stats shape                      |
| `TPerformanceMonitoringStrategy`    | `performance/types.ts`          | Union for monitoring backends           |
| `IPerformanceMetrics`               | `performance/types.ts`          | Single performance measurement          |
| `IAggregatedPerformanceStats`       | `performance/types.ts`          | Aggregated performance stats            |
| `IPerformancePluginOptions`         | `performance/types.ts`          | Plugin config                           |
| `IPerformanceStorage`               | `performance/types.ts`          | Storage backend contract                |
| `ISystemMetricsCollector`           | `performance/types.ts`          | System metrics collector contract       |
| `IPerformancePluginStats`           | `performance/types.ts`          | Plugin stats shape                      |
| `TUsageTrackingStrategy`            | `usage/types.ts`                | Union for usage storage backends        |
| `IUsageStats`                       | `usage/types.ts`                | Single usage record                     |
| `IAggregatedUsageStats`             | `usage/types.ts`                | Aggregated usage stats                  |
| `IUsagePluginOptions`               | `usage/types.ts`                | Plugin config                           |
| `IUsageStorage`                     | `usage/types.ts`                | Storage backend contract                |
| `IUsagePluginStats`                 | `usage/types.ts`                | Plugin stats shape                      |
| `TWebhookEventName`                 | `webhook/types.ts`              | Union for webhook event names           |
| `IWebhookPayload`                   | `webhook/types.ts`              | HTTP payload sent to endpoints          |
| `IWebhookEndpoint`                  | `webhook/types.ts`              | Endpoint configuration record           |
| `IWebhookPluginOptions`             | `webhook/types.ts`              | Plugin config                           |
| `IWebhookPluginStats`               | `webhook/types.ts`              | Plugin stats shape                      |

## Public API Surface

### Plugin Classes

| Export                      | Kind  | Description                                            |
| --------------------------- | ----- | ------------------------------------------------------ |
| `ConversationHistoryPlugin` | class | Persists conversation history with pluggable storage   |
| `ErrorHandlingPlugin`       | class | Error recovery with circuit-breaker / retry strategies |
| `ExecutionAnalyticsPlugin`  | class | Tracks timing and success/failure of agent operations  |
| `LimitsPlugin`              | class | Rate limiting on tokens, requests, and cost            |
| `LoggingPlugin`             | class | Multi-backend structured logging                       |
| `PerformancePlugin`         | class | System and application performance metrics             |
| `UsagePlugin`               | class | Token usage and cost tracking                          |
| `WebhookPlugin`             | class | HTTP webhook notifications for lifecycle events        |

### Storage / Utility Classes

| Export                       | Kind  | Description                                      |
| ---------------------------- | ----- | ------------------------------------------------ |
| `MemoryHistoryStorage`       | class | In-memory `IHistoryStorage` implementation       |
| `FileHistoryStorage`         | class | File-backed `IHistoryStorage` implementation     |
| `DatabaseHistoryStorage`     | class | Database-backed `IHistoryStorage` implementation |
| `ConsoleLogStorage`          | class | Console `ILogStorage` implementation             |
| `FileLogStorage`             | class | File-backed `ILogStorage` implementation         |
| `RemoteLogStorage`           | class | HTTP remote `ILogStorage` implementation         |
| `SilentLogStorage`           | class | No-op `ILogStorage` implementation               |
| `ConsoleLogFormatter`        | class | Console-style `ILogFormatter`                    |
| `JsonLogFormatter`           | class | JSON `ILogFormatter`                             |
| `MemoryUsageStorage`         | class | In-memory `IUsageStorage` implementation         |
| `FileUsageStorage`           | class | File-backed `IUsageStorage` implementation       |
| `RemoteUsageStorage`         | class | HTTP remote `IUsageStorage` implementation       |
| `SilentUsageStorage`         | class | No-op `IUsageStorage` implementation             |
| `MemoryPerformanceStorage`   | class | In-memory `IPerformanceStorage` implementation   |
| `NodeSystemMetricsCollector` | class | Node.js `ISystemMetricsCollector` implementation |
| `WebhookTransformer`         | class | Transforms agent events into `IWebhookPayload`   |
| `WebhookHttpClient`          | class | Sends webhook requests with retry logic          |

### Utility Functions

| Export                     | Kind     | Description                                                            |
| -------------------------- | -------- | ---------------------------------------------------------------------- |
| `aggregateUsageStats`      | function | Aggregates `IUsageStats[]` into `IAggregatedUsageStats`                |
| `aggregateExecutionStats`  | function | Aggregates `IExecutionStats[]` into `IAggregatedExecutionStats`        |
| `toErrorContext`           | function | Converts `IErrorHandlingContextData` to PluginError-compatible context |
| `createPluginErrorContext` | function | Factory for PluginError context from error handling state              |

### Supplementary Types (also exported from index)

| Export                          | Kind      | Description                                                    |
| ------------------------------- | --------- | -------------------------------------------------------------- |
| `ILimitsPluginExecutionContext` | interface | Extended execution context for `LimitsPlugin`                  |
| `ILimitsPluginExecutionResult`  | interface | Execution result shape expected by `LimitsPlugin`              |
| `ILoggingContextData`           | interface | Structured log context data (re-exported from `LoggingPlugin`) |

## Extension Points

### Custom Storage Backends

Consumers implement storage interfaces from this package to provide custom persistence:

| Interface             | Implemented by Plugin       |
| --------------------- | --------------------------- |
| `IHistoryStorage`     | `ConversationHistoryPlugin` |
| `ILogStorage`         | `LoggingPlugin`             |
| `IUsageStorage`       | `UsagePlugin`               |
| `IPerformanceStorage` | `PerformancePlugin`         |

Example — custom history storage:

```ts
import type { IHistoryStorage, IConversationHistoryEntry } from '@robota-sdk/agent-plugin';

class RedisHistoryStorage implements IHistoryStorage {
  async save(id: string, entry: IConversationHistoryEntry) {
    /* ... */
  }
  async load(id: string) {
    /* ... */
  }
  async list() {
    /* ... */
  }
  async delete(id: string) {
    /* ... */
  }
  async clear() {
    /* ... */
  }
}

const plugin = new ConversationHistoryPlugin({
  storage: 'memory', // overridden internally when you pass a custom storage instance
});
```

### Custom Error Handler

`ErrorHandlingPlugin` accepts a `customErrorHandler` callback for application-specific
recovery logic:

```ts
const plugin = new ErrorHandlingPlugin({
  strategy: 'simple',
  customErrorHandler: async (error, context) => {
    await notifyOpsTeam(error, context);
  },
});
```

### Custom IPlugin (via agent-core)

Consumers who need a plugin outside the 8 official implementations extend via `agent-core`:

```ts
import type { IPlugin } from '@robota-sdk/agent-core';

const myPlugin: IPlugin = {
  name: 'my-plugin',
  hooks: {
    beforeExecution: async (input) => {
      /* ... */
    },
  },
};
robota.use(myPlugin);
```

### Webhook Payload Transformer

`WebhookPluginOptions.payloadTransformer` allows consumers to reshape event data before
it is sent to endpoints:

```ts
const plugin = new WebhookPlugin({
  endpoints: [{ url: 'https://example.com/hook' }],
  payloadTransformer: (event, data) => ({ ...data, extra: 'field' }),
});
```

## Error Taxonomy

All error classes below are defined in `@robota-sdk/agent-core` and thrown by this package.

| Error Class          | Category      | When Thrown                                                                                                   | Recoverable         |
| -------------------- | ------------- | ------------------------------------------------------------------------------------------------------------- | ------------------- |
| `ConfigurationError` | Configuration | Invalid or missing options during plugin construction (strategy, filePath, connectionString, retries, etc.)   | No — fix config     |
| `PluginError`        | Runtime       | Storage write/read failure during execution; circuit breaker open; webhook validation failure; limit exceeded | Depends on strategy |
| `StorageError`       | Storage       | File or database I/O failure in `FileHistoryStorage`, `DatabaseHistoryStorage`, `FileUsageStorage`            | Depends on cause    |

`StorageError` and `PluginError` propagate from storage backends into plugin methods. Consumers
should catch `PluginError` at the agent execution boundary.

## Test Strategy

### Current Test Files (17 total)

| Test File                                                            | Covers                                                                 |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `conversation-history/__tests__/conversation-history-plugin.test.ts` | `ConversationHistoryPlugin` lifecycle and message ops                  |
| `conversation-history/__tests__/history-storages.test.ts`            | `MemoryHistoryStorage`, `FileHistoryStorage`, `DatabaseHistoryStorage` |
| `error-handling/__tests__/error-handling-plugin.test.ts`             | All 4 strategies, circuit breaker state, retries                       |
| `execution-analytics/__tests__/execution-analytics-plugin.test.ts`   | Recording, aggregation, lifecycle                                      |
| `limits/__tests__/limits-plugin.test.ts`                             | Token bucket, sliding window, fixed window, none                       |
| `logging/__tests__/formatters.test.ts`                               | `ConsoleLogFormatter`, `JsonLogFormatter`                              |
| `logging/__tests__/logging-plugin.test.ts`                           | `LoggingPlugin` strategies and levels                                  |
| `logging/__tests__/logging-storages.test.ts`                         | All 4 log storage backends                                             |
| `performance/__tests__/memory-storage.test.ts`                       | `MemoryPerformanceStorage` CRUD                                        |
| `performance/__tests__/performance-plugin.test.ts`                   | `PerformancePlugin` hook integration                                   |
| `performance/__tests__/system-metrics-collector.test.ts`             | `NodeSystemMetricsCollector`                                           |
| `usage/__tests__/aggregate-usage-stats.test.ts`                      | `aggregateUsageStats` function                                         |
| `usage/__tests__/memory-storage.test.ts`                             | `MemoryUsageStorage` CRUD                                              |
| `usage/__tests__/silent-storage.test.ts`                             | `SilentUsageStorage` no-op contract                                    |
| `usage/__tests__/usage-plugin-helpers.test.ts`                       | Internal helpers                                                       |
| `usage/__tests__/usage-plugin.test.ts`                               | `UsagePlugin` lifecycle and event handling                             |
| `webhook/__tests__/webhook-plugin.test.ts`                           | `WebhookPlugin` delivery and retry                                     |

### Coverage Gaps

- No tests for `WebhookTransformer` or `WebhookHttpClient` in isolation.
- `FileUsageStorage` and `RemoteUsageStorage` lack dedicated test files.
- `PerformancePlugin` file/remote/prometheus strategy paths are untested (not yet implemented).

## Class Contract Registry

### AbstractPlugin Implementations

All 8 plugin classes extend `AbstractPlugin` from `@robota-sdk/agent-core`.

| Class                       | Extends                                                                              | Plugin Category            | Priority                   |
| --------------------------- | ------------------------------------------------------------------------------------ | -------------------------- | -------------------------- |
| `ConversationHistoryPlugin` | `AbstractPlugin<IConversationHistoryPluginOptions, IConversationHistoryPluginStats>` | `STORAGE`                  | `HIGH`                     |
| `ErrorHandlingPlugin`       | `AbstractPlugin<IErrorHandlingPluginOptions, IErrorHandlingPluginStats>`             | configured at construction | configured at construction |
| `ExecutionAnalyticsPlugin`  | `AbstractPlugin<IExecutionAnalyticsOptions, IExecutionAnalyticsPluginStats>`         | configured at construction | configured at construction |
| `LimitsPlugin`              | `AbstractPlugin<ILimitsPluginOptions>` (no stats generic)                            | configured at construction | configured at construction |
| `LoggingPlugin`             | `AbstractPlugin<ILoggingPluginOptions, ILoggingPluginStats>`                         | configured at construction | configured at construction |
| `PerformancePlugin`         | `AbstractPlugin<IPerformancePluginOptions, IPerformancePluginStats>`                 | configured at construction | configured at construction |
| `UsagePlugin`               | `AbstractPlugin<IUsagePluginOptions, IUsagePluginStats>`                             | configured at construction | configured at construction |
| `WebhookPlugin`             | `AbstractPlugin<IWebhookPluginOptions, IWebhookPluginStats>`                         | configured at construction | configured at construction |

### Storage Interface Implementations

| Class                        | Implements                |
| ---------------------------- | ------------------------- |
| `MemoryHistoryStorage`       | `IHistoryStorage`         |
| `FileHistoryStorage`         | `IHistoryStorage`         |
| `DatabaseHistoryStorage`     | `IHistoryStorage`         |
| `ConsoleLogStorage`          | `ILogStorage`             |
| `FileLogStorage`             | `ILogStorage`             |
| `RemoteLogStorage`           | `ILogStorage`             |
| `SilentLogStorage`           | `ILogStorage`             |
| `MemoryUsageStorage`         | `IUsageStorage`           |
| `FileUsageStorage`           | `IUsageStorage`           |
| `RemoteUsageStorage`         | `IUsageStorage`           |
| `SilentUsageStorage`         | `IUsageStorage`           |
| `MemoryPerformanceStorage`   | `IPerformanceStorage`     |
| `NodeSystemMetricsCollector` | `ISystemMetricsCollector` |

## Dependency Rules

### Allowed

- `@robota-sdk/agent-core` — plugin interface, base class, error types, timer utilities
- `jssha` — HMAC signing for webhook (used only within `webhook/`)

### Forbidden

- `@robota-sdk/agent-framework` — orchestration layer, must not be imported
- `@robota-sdk/agent-session` — session layer, must not be imported
- `@robota-sdk/agent-tools` — tool infrastructure, must not be imported
- Cross-submodule imports — e.g., `logging/` must not import from `usage/`

Detection:

- `pnpm madge --circular --ts-config tsconfig.json src/`
- `grep -r "agent-plugin" packages/agent-core/src/` — must return empty

## Build

- Bundler: tsdown (ESM + CJS dual output)
- Output: `dist/node/index.{js,cjs,d.ts}`
- Tree-shaking: enabled — unused plugins are excluded from consumer bundles
