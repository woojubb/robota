---
'@robota-sdk/agent-interface-execution': major
'@robota-sdk/agent-executor': major
'@robota-sdk/agent-session': patch
'@robota-sdk/agent-framework': patch
---

Discriminate `IBackgroundTaskResult` by kind, the same way `TBackgroundTaskRequest` already is:
`exitCode`/`signalCode` exist only on the `process` member and `usage` only on the `agent` member,
instead of being optional-and-unreachable on every kind. `IBackgroundTaskResult<K>` narrows to the
kind-specific member; called with no type argument it is still the full union, which is what
`IBackgroundTaskState.result` continues to hold (that field stays undiscriminated — a later change).
`ISubagentJobResult` is now derived as `Omit<IBackgroundTaskResult<'agent'>, 'kind'>` rather than a
hand-maintained `Omit<IBackgroundTaskResult, 'kind' | 'exitCode' | 'signalCode'>`.

`IBackgroundTaskHandle` gains the same kind parameter as `IBackgroundTaskStart`: a runner declared
for kind `K` resolves its handle's `result` to `IBackgroundTaskResult<K>`, so a caller that starts a
known-kind runner gets a correctly-narrowed result with no cast, and reading a cross-kind field on it
is a compile error. Consumers reading `state.result` through the generic (kind-erased) manager or
task-state path are unaffected in behavior, but a `.exitCode`/`.signalCode`/`.usage` read there must
now narrow on the result's own `kind` first, since the fallback default keeps `IBackgroundTaskResult`
as the full union rather than the previously flat, always-present shape.

`agent-session`'s session-record decoder now rejects a persisted result carrying a field outside its
own kind (e.g. an `'agent'` result with `exitCode`) as corrupt, reported at that field's own path —
the same corruption-reporting style the taskId/kind identity check already uses.

**Breaking for `@robota-sdk/agent-interface-execution` and `@robota-sdk/agent-executor`**: code that
read `exitCode`/`signalCode`/`usage` off an unnarrowed `IBackgroundTaskResult`, or that implemented
`IBackgroundTaskHandle`/a custom runner without specifying its kind parameter, needs to narrow on
`result.kind` (or specify the kind parameter) before those fields are visible again.
