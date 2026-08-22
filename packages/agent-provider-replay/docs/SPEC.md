# @robota-sdk/agent-provider-replay — Package Specification

## Scope

A deterministic AI provider that replays a recorded Robota **session log** instead of calling a
network model. It lets a real conversation run offline, with no model key, by re-emitting the
`provider_response_normalized` responses the framework already records per provider call. This is the
provider axis of TEST-008 (drive the real agent programmatically) and unblocks deterministic
end-to-end tests (e.g. SCREEN-010 streaming→commit).

## Boundaries

- **Implements** the `@robota-sdk/agent-core` `AbstractAIProvider` contract (`chat` / `chatStream`).
- **Consumes** already-hydrated recorded session-log lines (typed via `@robota-sdk/agent-session` —
  `ISessionLogLine`, `SESSION_LOG_EVENT`). File-backed composition receives explicit session-log and
  external-payload sources owned by `agent-session`; this package opens no path and owns no filesystem reader.
- **No network, no clock/random dependence** in replayed content — output is a pure function of the
  recorded log.
- Depends only on `@robota-sdk/agent-core` (provider contract) and `@robota-sdk/agent-session` (log
  schema + `loadSessionLogEntries`). Must not depend on transports, CLI, or the framework.
- Not a production conversational provider; for testing/automation/offline replay only.

## Architecture Overview

The framework drives a turn by calling `provider.chat(messages)` once per round. `ReplayProvider`
holds the recorded normalized responses (extracted from `provider_response_normalized` events in
recorded order) and returns the next one on each `chat()` call. `chatStream()` yields the recorded
response as a single chunk (sufficient to exercise the streaming→commit path). When the recorded
responses are exhausted, `chat()` rejects.

```
explicit log/payload sources ──loadSessionLogEntries + hydration──▶ ISessionLogLine[]
                         │ filter resolved provider_response_normalized
                         ▼
                 ReplayProvider.responses[] ──chat()/chatStream()──▶ TUniversalMessage
```

## Type Ownership

- Owns: `ReplayProvider`, `IReplayProviderOptions`, `IReplayProviderFromSourceOptions`.
- Consumes (does not own): `AbstractAIProvider`, `TUniversalMessage`, `IChatOptions`
  (`@robota-sdk/agent-core`); `ISessionLogLine`, `SESSION_LOG_EVENT`, `loadSessionLogEntries`,
  `resolveSessionLogExternalPayloads`, and `SessionLogPayloadResolutionError`
  (`@robota-sdk/agent-session`).

## Public API Surface

- `class ReplayProvider extends AbstractAIProvider` — `chat`, `chatStream`, `supportsTools`,
  `recordedResponseCount`.
- `interface IReplayProviderOptions { entries; name?; version? }` — entries must already be hydrated; direct
  construction is I/O-free and rejects an unresolved external-payload reference.
- `interface IReplayProviderFromSourceOptions { logSource; payloadSource?; name?; version?; limits? }` — explicit
  neutral source composition.
- `createReplayProviderFromSource(options): ReplayProvider` — loads/hydrates through supplied sources.

The source factory partitions external-payload limits to `loadSessionLogEntries` and hydrates the complete log
exactly once. Direct `ReplayProvider` construction performs no I/O and throws typed `UNRESOLVED_REFERENCE` when
a consumed normalized response still contains a reference. References in observability, tool, text-delta, or
user events remain ignored.

## Extension Points

- Streaming fidelity: `chatStream` may later replay byte-exact `text_delta` events instead of a single
  chunk.
- Keyed replay: responses may be matched by `executionId`+`round` (see `IProviderEventKey`) rather
  than recorded order, for non-linear/branching replay.

## Error Taxonomy

- **Log exhausted** — `chat()` rejects with `[replay] no recorded provider response for call #N …`
  when more calls are made than there are recorded responses.
- **Unresolved external response** — direct construction rejects with
  `SessionLogPayloadResolutionError` code `UNRESOLVED_REFERENCE`; it never accepts a base-directory escape.
  Explicit-source containment, integrity, JSON, cycle, depth, and aggregate failures preserve the resolver's
  stable typed code.
- Malformed recorded responses (missing/invalid `role`) are skipped during extraction only after any
  external reference has been resolved or rejected; they never shift a later response because a
  well-formed externalized response was silently omitted.

## Class Contract Registry

- `ReplayProvider` — `AbstractAIProvider`: `chat(messages, options) → Promise<TUniversalMessage>`
  returns recorded responses in order; `chatStream(messages, options)` yields the recorded response;
  `recordedResponseCount` reports how many responses are available.

## Test Strategy

Vitest unit/integration tests cover ordered replay + exhaustion (TC-03), tool-call turn then completion
(TC-04), non-substrate isolation, I/O-free direct construction, explicit-source nested sidecar
hydration, corruption/containment/bounds failures, and `chatStream`. A real `InteractiveSession` scripted
functional test records and replays a response over 32 KiB followed by a sentinel and is registered as
`session-log-external-payload-replay` in the functional-coverage manifest. That real-session test and its
maintained standalone example live in `agent-framework`, which owns `InteractiveSession`; they consume
this provider through its public barrel and print byte/hash/alignment/cleanup evidence. The replay
provider itself retains only core + session dependencies, preserving provider-layer direction.
