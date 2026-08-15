# @robota-sdk/agent-provider-replay — Package Specification

## Scope

A deterministic AI provider that replays a recorded Robota **session log** instead of calling a
network model. It lets a real conversation run offline, with no model key, by re-emitting the
`provider_response_normalized` responses the framework already records per provider call. This is the
provider axis of TEST-008 (drive the real agent programmatically) and unblocks deterministic
end-to-end tests (e.g. SCREEN-010 streaming→commit).

## Boundaries

- **Implements** the `@robota-sdk/agent-core` `AbstractAIProvider` contract (`chat` / `chatStream`).
- **Reads** recorded session-log lines (typed via `@robota-sdk/agent-session` —
  `ISessionLogLine`, `SESSION_LOG_EVENT`) and consumes that package's sole external-payload resolver;
  does not write logs and owns no second filesystem reader.
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
session log (JSONL) ──loadSessionLogEntries + sidecar hydration──▶ ISessionLogLine[]
                         │ filter resolved provider_response_normalized
                         ▼
                 ReplayProvider.responses[] ──chat()/chatStream()──▶ TUniversalMessage
```

## Type Ownership

- Owns: `ReplayProvider`, `IReplayProviderOptions`, `TReplayProviderFromLogFileOptions`.
- Consumes (does not own): `AbstractAIProvider`, `TUniversalMessage`, `IChatOptions`
  (`@robota-sdk/agent-core`); `ISessionLogLine`, `SESSION_LOG_EVENT`, `loadSessionLogEntries`,
  `resolveSessionLogExternalPayloads`, and `SessionLogPayloadResolutionError`
  (`@robota-sdk/agent-session`).

## Public API Surface

- `class ReplayProvider extends AbstractAIProvider` — `chat`, `chatStream`, `supportsTools`,
  `recordedResponseCount`.
- `interface IReplayProviderOptions { entries; name?; version?; externalPayloadBaseDirectory?;
maxExternalPayloadDepth?; maxExternalPayloadTotalBytes? }`.
- `type TReplayProviderFromLogFileOptions` — file-factory options that exclude already-owned entries
  and the log-derived external-payload base directory.
- `createReplayProviderFromLogFile(logFile, options?): ReplayProvider` — convenience loader.

The file factory partitions external-payload limits to `loadSessionLogEntries`, which derives the base
directory and hydrates the complete log exactly once. It constructs `ReplayProvider` with the hydrated
entries and does not forward a base directory. Direct `ReplayProvider` construction inspects only
`provider_response_normalized.response` values: with an explicit base directory it hydrates those values
through the shared `agent-session` resolver and one aggregate budget; without a base directory it throws
typed `UNRESOLVED_REFERENCE` when a consumed response still contains a reference. References in
observability, tool, text-delta, or user events remain ignored.

## Extension Points

- Streaming fidelity: `chatStream` may later replay byte-exact `text_delta` events instead of a single
  chunk.
- Keyed replay: responses may be matched by `executionId`+`round` (see `IProviderEventKey`) rather
  than recorded order, for non-linear/branching replay.

## Error Taxonomy

- **Log exhausted** — `chat()` rejects with `[replay] no recorded provider response for call #N …`
  when more calls are made than there are recorded responses.
- **Unresolved external response** — direct construction rejects with
  `SessionLogPayloadResolutionError` code `UNRESOLVED_REFERENCE` unless an explicit base directory is
  supplied. Containment, integrity, JSON, cycle, depth, and aggregate failures preserve the resolver's
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
(TC-04), non-substrate isolation, direct-construction unresolved/base-directory behavior, nested sidecar
hydration, corruption/containment/bounds failures, and `chatStream`. A real `InteractiveSession` scripted
functional test records and replays a response over 32 KiB followed by a sentinel and is registered as
`session-log-external-payload-replay` in the functional-coverage manifest. The maintained standalone
`examples/verify-session-log-external-payload-replay.ts` drives the same public SDK surface without a
test runner and prints byte/hash/alignment/cleanup evidence. Dependency direction (core + session only at
runtime; framework and `tsx` development-only for verification) is enforced by `pnpm harness:scan`.
