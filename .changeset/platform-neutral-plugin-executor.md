---
'@robota-sdk/agent-core': minor
'@robota-sdk/agent-plugin': minor
'@robota-sdk/agent-executor': minor
---

Make the plugin and executor packages platform-neutral.

- `@robota-sdk/agent-core` exports `sha256Hex` (string or bytes), `hmacSha256Hex`, `randomHex` and `constantTimeEqual`, built on `jssha` and `crypto.getRandomValues`, so neutral packages need no `node:crypto`.
- `@robota-sdk/agent-plugin`: the `file` strategies of `ConversationHistoryPlugin`, `LoggingPlugin` and `UsagePlugin` write through a `fileStore` option (the new `IPluginTextFileStore` port) and throw a `ConfigurationError` at construction without one; `FileHistoryStorage`, `FileUsageStorage` and `FileLogStorage` take the store as a constructor argument. `NodePluginTextFileStore` is the Node implementation, and `NodeSystemMetricsCollector` moved from the main entry, both on the new `@robota-sdk/agent-plugin/node`. `PerformancePlugin` reads system metrics only through a `metricsCollector` option: memory and CPU monitoring default to on when one is given and off otherwise, and turning monitoring on without one throws a `ConfigurationError` at construction.
- `@robota-sdk/agent-executor`: `createDefaultBackgroundTaskRunners`, `createManagedShellProcessRunner`, `createScheduledTaskRunner`, `resolveBackgroundTaskShellCommand` and their option types moved to `@robota-sdk/agent-executor/node`; `nextScheduledFireOnOrAfter` stays on the main entry. `reportObserverFailureAsWarning` is replaced by `reportObserverFailureAsProcessWarning` on `/node`; the default observer-failure reporter of `BackgroundTaskManager` now writes a `console.warn` line prefixed with the same code (on Node it still reaches stderr), so a host that wants the process warning passes `onObserverFailure` (`SubagentManager` forwards the new option of that name).
- `@robota-sdk/agent-executor`: the environment resolver argument of `resolveProfileApiKey`, `createProviderFromProfile` and `createProviderFromExactProfile` is required (pass `processEnvResolver` from `@robota-sdk/agent-core/node`), and `hookTypeExecutors` is a required option of `createWorktreeSubagentRunner` and `WorktreeSubagentRunner`, which no longer default to the command and HTTP hook executors.
