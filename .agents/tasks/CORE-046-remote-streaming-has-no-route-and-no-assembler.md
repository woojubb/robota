---
title: 'CORE-046: remote streaming has neither a served route nor an owner for chunk assembly — the client that pretended otherwise was removed by CORE-044, so restoring the capability now needs a transport decision and an assembler, not a reconnected call'
status: todo
created: 2026-08-16
priority: medium
urgency: next
area: packages/agent-remote-client, apps/agent-server
depends_on: []
---

# CORE-046: remote streaming needs a transport and an assembler, not a route

Split out of [CORE-044](completed/CORE-044-remote-executor-drops-every-per-call-option.md), which removed the
broken half rather than leaving it in place.

## What was removed and why

Before CORE-044 the remote seam appeared to support streaming and did not:

- `HttpClient.chatStream` posted to `${baseUrl}/stream`;
- `createStreamTransportRequest` named a second spelling, `/chat/stream`;
- `apps/agent-server/src/app.ts` and `apps/agent-server/docs/SPEC.md` both claimed the stream route
  was inlined;
- **no server in this repository served either spelling.**

Every remote streaming call was a 404. The suite was green because the tests drove a mocked `fetch`,
which is the mechanism worth remembering: a mocked transport cannot notice that the far end does not
exist.

CORE-044 deleted the client rather than implementing the route, because the foundation the client
depended on is gone. `SimpleRemoteExecutor.executeChatStream` yielded raw provider chunks with the
comment _"ExecutionService merges them"_ — and that fragment assembler was deleted with the second
execution engine in CORE-042. Wiring a route to a client that emits unassembled tool-call fragments,
against a fragmentation behaviour no in-repo test can observe, risks silently corrupting tool calls:
the failure class CORE-042 existed to end.

**Nothing works less than it did.** `IExecutor.executeChatStream` is optional, so a provider
configured with the remote executor now reports `supportsStreaming: false`, and a caller reaching for
it gets an accurate error instead of a 404. Since CORE-042 the turn drives streaming through
`chat()` + `onTextDelta` rather than `provider.chatStream`, so no product path lost a capability.

## What restoring it actually requires

Three decisions, none of which is "reconnect the call":

1. **A transport.** SSE or chunked transfer. The removed client parsed SSE `data:` frames with a
   `[DONE]` sentinel, which is a reasonable starting point but was never validated against a server.
2. **A served route, spelled once.** One name, in the server's route table, in the client, and in
   `apps/agent-server/docs/SPEC.md` — the three-spellings state is what made the gap survivable.
3. **An owner for chunk assembly.** Provider chunks carry tool-call fragments that must be
   accumulated before they mean anything. Decide whether the SERVER assembles and streams only text
   deltas (which fits the post-CORE-042 contract, where a provider streams internally and returns the
   complete assembled message) or the CLIENT re-implements an accumulator. The first is strongly
   preferred: it keeps one assembler in the world, and it matches what `IChatOptions.onTextDelta`
   already asks every provider to do.

Option 3-first is likely the whole design: if the server assembles, the wire carries text deltas plus
one terminal assembled message, and the client's job is to call `options.onTextDelta` per delta and
return the terminal message — which is exactly the `IAIProvider` contract every direct adapter already
implements.

## Test Plan

- A test that the client's streaming call reaches a route the server actually registers — asserted
  against the route table, not a mocked `fetch`, because a mock is what hid this for as long as it
  lasted.
- A tool-calling remote turn end to end: the assembled tool call the model emitted is the tool call
  the agent executes, with no fragment leakage.
- Cancellation: aborting a remote streaming run stops the HTTP request, matching the non-streaming
  path CORE-044 wired.
- `packages/agent-remote-client/src/client/__tests__/remote-executor-simple.test.ts` currently pins
  that `executeChatStream` is absent; that case is the one to invert, so the capability cannot be
  half-restored without the assertion being updated deliberately.

## User Execution Test Scenarios

**Applies** — remote streaming is a user-facing capability of a published package. Author the scenario
when the item is picked up; it needs `apps/agent-server` running locally, which the work can start as
part of the scenario, plus a provider key OR a stub provider registered in the server's provider map.
