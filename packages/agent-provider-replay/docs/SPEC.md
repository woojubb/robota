# @robota-sdk/agent-provider-replay Specification

## Purpose

A deterministic AI provider that replays a recorded Robota session log instead of calling a network
model, letting a real conversation run offline with no model key by re-emitting the recorded
provider responses. Used to drive the real agent programmatically for deterministic, offline
end-to-end tests.

## Contract

- Implements the `agent-core` `AbstractAIProvider` contract (`chat` / `chatStream`).
- Consumes versioned, decoded recorded session-log entries via `agent-session`. Neutral composition
  takes an explicit `ISessionLogSource`; the `createReplayProviderFromNodeLogFile` convenience adapter
  is the one place host-filesystem I/O enters, through `agent-session`'s `NodeSessionLogSource` —
  supplying a filename does not itself establish workspace authority.
- Output is a pure function of the recorded log: no network, clock, or random dependence in replayed
  content.
- Depends only on `agent-core` (provider contract) and `agent-session` (log schema + loader); must not
  depend on transports, CLI, or the framework.
- Not a production conversational provider — testing/automation/offline replay only.

## Guarantees

- Every event in the log must decode, including diagnostic events; an invalid entry never
  disappears by filtering for normalized responses only.
- Message IDs, dates, and roles are preserved by the shared decoder rather than synthesized.
- When external payload references remain, only an explicitly supplied payload source can hydrate
  them, under one shared depth/byte budget; absent authority yields a typed `UNRESOLVED_REFERENCE`
  error rather than a silent gap. Already-hydrated inputs require no further payload reads.

## Error taxonomy

- **Log exhausted** — `chat()` rejects once more calls are made than there are recorded responses.
- **Unresolved external response** — rejects with `SessionLogPayloadResolutionError`
  (`UNRESOLVED_REFERENCE`); never accepts a base-directory escape. Containment, integrity, JSON,
  cycle, depth, and aggregate failures preserve the resolver's stable typed code.
- **Invalid or unsupported log** — rejects with `SessionLogDecodeError`, preserving the session-owned
  code and located issue; malformed responses are never skipped or replaced with invented fields.

## Non-goals

- Not a network-calling or production provider.
- Must not depend on transports, CLI, or the framework — only `agent-core` and `agent-session`.
- Framework-level real-session verification (e.g. exercising a real `InteractiveSession`) belongs to
  `agent-framework`, which owns that type; this package is only consumed there through its public
  barrel, preserving provider-layer dependency direction.
