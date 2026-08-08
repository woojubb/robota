# agent-transport-http Specification

## Scope

HTTP transport (Hono) for the Robota SDK. Split out of the consolidated `agent-transport` package
(DQ-AUDIT-005) so the `hono` dependency is an isolated unit.

## Boundaries

- Owns the Hono-based HTTP transport adapter and agent route builder.
- Depends only on `agent-interface-transport` (transport contracts) — contract-pure, per
  `project-structure.md`. The one side concern (where a stream-failure detail goes) is INJECTED
  (`IAgentRoutesOptions.onStreamFailure`), not imported; see § Error Taxonomy.
- No other transport package depends on this one.

## Architecture Overview

```
agent-transport-http
  ├── createHttpTransport   ← ITransportAdapter over Hono
  └── createAgentRoutes     ← Hono route builder for an agent session factory
```

## Type Ownership

Owns `IHttpTransportOptions`, `IAgentRoutesOptions`, `TSessionFactory`.

## Public API Surface

| Export                | Kind     | Description                        |
| --------------------- | -------- | ---------------------------------- |
| `createHttpTransport` | function | Hono-based HTTP transport adapter  |
| `createAgentRoutes`   | function | Build agent routes onto a Hono app |

## Extension Points

New routes extend `createAgentRoutes`; new options extend the option interfaces.

### `TSessionFactory` need not be identity-stable

`/submit` refuses a second concurrent turn on one session. That claim is keyed by
`getSession().getSessionId()`, so a factory returning a fresh wrapper per call — a proxy, an
adapter, a spread copy — is handled: the wrappers differ, the id does not.

It was keyed on object IDENTITY first, which made identity-stability a requirement callers were
never told about and nothing could check. This section said so, and review pointed out that the
contract already supplies the id. A requirement the type system cannot express and no test can
catch is not a contract; using what the session already promises removes it instead of documenting
it.

The guard is only as good as the id. Two sessions that report the SAME `getSessionId()` are one
session to this route, and they will 409 each other until whichever holds the claim finishes or
disconnects. That is a contract violation upstream — `getSessionId()` names a session — but the
consequence is worth stating for anyone mounting this route across a trust boundary where the ids
come from somewhere they do not control.

A session that cannot name itself cannot be claimed, so `/submit` REFUSES it — HTTP 500, with no
turn started. There is no `isExecuting()` fallback on that path: a fallback would start a turn this
route cannot guarantee belongs to the caller, which is the concurrency guarantee above stated
backwards.

`/executing` is the one place the unnameable session still answers, and it answers from
`isExecuting()` alone — reporting what a session is doing is not the same act as admitting a new
turn to it.

This paragraph described the fallback design for one round after the code stopped implementing it,
and review caught the drift against `routes.ts`. A contract document that is one revision behind the
code is worse than no document, because it is believed.

## Error Taxonomy

HTTP errors surface as Hono responses; no new error classes.

What crosses the boundary is split by who wrote the message. The session's `error` EVENT is relayed
verbatim on the SSE `error` channel — it is the session's client-facing wording (`humanizeApiError`)
and the WS transport relays it identically. An exception ESCAPING the stream callback after the
headers went out is not a message anything composed for a client: the client gets a generic line and
the detail goes to the host's injected `onStreamFailure` listener (absent = the host chose to drop
it), the same withholding the `/submit` 500 branch practices.

The callback swallows its own failures rather than passing an `onError` to `streamSSE`, and that is
load-bearing: Hono's runner follows any `onError` by writing the raw `e.message` to the stream, so
an escaped exception reaches the client verbatim regardless of what the handler withheld. Measured —
the body carried two error events, the generic line and the leak — and pinned by a test asserting
the raw message is absent from the body.

## Test Strategy

Route + transport unit tests under `src/__tests__`.

## Dependencies

- `@robota-sdk/agent-interface-transport`.
- External: `hono`.
