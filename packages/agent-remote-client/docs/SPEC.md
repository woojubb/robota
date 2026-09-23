# agent-remote-client Specification

## Purpose

Owns the client-side remote execution layer for Robota SDK: a `RemoteExecutor` that implements
`IExecutor` and proxies AI provider calls to a remote server over HTTP (non-streaming and SSE
streaming), plus the low-level HTTP client it's built on. The server it calls is an external
provider-gateway, out of this monorepo — this package is not the client counterpart to
`agent-transport-http` or `agent-transport-ws`, which serve a different, session-oriented protocol.

## Non-goals / Boundaries

- Does not own core agent/provider contracts (`IExecutor`, `IAIProvider`, `IAssistantMessage`) —
  imported from `agent-core`.
- Does not own server-side hosting logic, and does not own the in-repo WebSocket transport
  contract (`agent-transport-ws`'s job).
- Single production dependency: `@robota-sdk/agent-core`. Private package, not published to npm.

## Contract

For a selected model-effort tier, the wire carries only the effort _selection_; the server-side
adapter resolves its own capability table and returns one serializable outcome. The client
validates and preserves that value and invokes the caller's outcome callback exactly once,
catching observer failures — it never invents an opaque or native outcome itself, and neither the
adapter-bound resolution logic nor the callback function is ever serialized onto the wire.

**The client does not assemble streamed chunks.** The server already drives the provider's own
text-delta callback, so the wire carries per-delta text plus one terminal assembled message (and,
when applicable, one terminal effort-outcome frame). The client hands deltas to the caller's
callback and yields exactly one message event followed by one terminal event — never a partial
message treated as a completed result. A stream that ends without a terminal message is a failure,
not a short answer: re-implementing an accumulator here would create a second assembler with its
own fragmentation behavior that no test in this repo could observe against the real one.

## Design decision: assert the stream path, don't just describe it

This document previously stated the wrong streaming path twice in a row, and the client's own
tests stayed green throughout because they mocked `fetch` — a mocked transport agrees with
whatever the client asserts, so a wrong path and a wrong doc were mutually invisible. The path
constant is now exported from the package entry specifically so the server's own tests can compare
it against their route table, making the two sides' agreement a mechanical fact rather than a
documented claim.

## Error semantics

Validation failures (empty/missing messages, missing provider or model, malformed message shape,
missing base URL or API key) surface as thrown errors with a specific, named condition rather than
a generic failure. Non-2xx HTTP responses and unhandled errors during the request or the SSE read
loop are likewise surfaced as distinct, named error conditions rather than silently swallowed or
folded into a generic result.
