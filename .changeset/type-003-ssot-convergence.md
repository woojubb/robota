---
'@robota-sdk/agent-core': patch
'@robota-sdk/agent-interface-transport': patch
'@robota-sdk/agent-executor': patch
'@robota-sdk/agent-remote-client': patch
'@robota-sdk/agent-framework': patch
'@robota-sdk/agent-session': minor
---

Type-SSOT convergence (TYPE-003; re-audit CONTRACT-002/003/011/012 + RUNTIME-47 + STRUCT-04). Behavior is unchanged — this is a type-level refactor. `ITokenUsage` (agent-core) is confirmed as the usage-triple SSOT: `ISessionUsageTotals` and `IBackgroundTaskUsage` become aliases, and every inline `{ promptTokens; completionTokens; totalTokens }` copy (service/orchestration/executor/remote-client shapes) now references the SSOT (structurally identical → patch). The subagent-job contracts derive from the background-task SSOT — `TSubagentJobStatus = Exclude<TBackgroundTaskStatus, 'paused'>`, mode alias, and a `Pick`-projection `ISubagentJobState` — with a compile-enforced parity test so a drifting hand copy can no longer exist. `@robota-sdk/agent-session` is minor because the public `ISessionRecord` type is now the typed `IInteractiveSessionRecord` alias (previously a relaxed `unknown[]` mirror): runtime behavior of `SessionStore` is identical, but downstream code that assigned loose payloads to the record's fields may need explicit casts at its own trust boundary (the framework store facade's `as unknown as` cast bridge is deleted). agent-session's duplicate `@robota-sdk/agent-core` deps/devDeps declaration is also removed (STRUCT-04).
