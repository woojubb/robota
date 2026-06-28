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
  `ISessionLogLine`, `SESSION_LOG_EVENT`); does not write logs.
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
session log (JSONL) ──loadSessionLogEntries──▶ ISessionLogLine[]
                         │ filter provider_response_normalized
                         ▼
                 ReplayProvider.responses[] ──chat()/chatStream()──▶ TUniversalMessage
```

## Type Ownership

- Owns: `ReplayProvider`, `IReplayProviderOptions`.
- Consumes (does not own): `AbstractAIProvider`, `TUniversalMessage`, `IChatOptions`
  (`@robota-sdk/agent-core`); `ISessionLogLine`, `SESSION_LOG_EVENT`, `loadSessionLogEntries`
  (`@robota-sdk/agent-session`).

## Public API Surface

- `class ReplayProvider extends AbstractAIProvider` — `chat`, `chatStream`, `supportsTools`,
  `recordedResponseCount`.
- `interface IReplayProviderOptions { entries; name?; version? }`.
- `createReplayProviderFromLogFile(logFile, options?): ReplayProvider` — convenience loader.

## Extension Points

- Streaming fidelity: `chatStream` may later replay byte-exact `text_delta` events instead of a single
  chunk.
- Keyed replay: responses may be matched by `executionId`+`round` (see `IProviderEventKey`) rather
  than recorded order, for non-linear/branching replay.

## Error Taxonomy

- **Log exhausted** — `chat()` rejects with `[replay] no recorded provider response for call #N …`
  when more calls are made than there are recorded responses.
- Malformed recorded responses (missing/invalid `role`) are skipped during extraction (not counted).

## Class Contract Registry

- `ReplayProvider` — `AbstractAIProvider`: `chat(messages, options) → Promise<TUniversalMessage>`
  returns recorded responses in order; `chatStream(messages, options)` yields the recorded response;
  `recordedResponseCount` reports how many responses are available.

## Test Strategy

Vitest unit tests (`src/__tests__/replay-provider.test.ts`): ordered replay + exhaustion error
(TC-03); tool-call turn then completion (TC-04); non-substrate events ignored; `chatStream` yields the
recorded response. Dependency direction (core + session only) is enforced by `pnpm harness:scan`.
