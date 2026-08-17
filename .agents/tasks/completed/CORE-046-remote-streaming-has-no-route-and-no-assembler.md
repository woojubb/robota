---
title: 'CORE-046: remote streaming has neither a served route nor an owner for chunk assembly — the client that pretended otherwise was removed by CORE-044, so restoring the capability now needs a transport decision and an assembler, not a reconnected call'
status: done
created: 2026-08-16
completed: 2026-08-17
priority: medium
urgency: next
area: packages/agent-remote-client, apps/agent-server
depends_on: []
---

# CORE-046: remote streaming needs a transport and an assembler, not a route

Split out of [CORE-044](CORE-044-remote-executor-drops-every-per-call-option.md), which removed the
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

## What was built, decision by decision

**Option 3-first was the whole design, and it decided the other two.**

1. **Transport: SSE**, chosen over chunked transfer because it FRAMES. A delta and the terminal
   message are different kinds of thing, and `event:` says which without the client inventing a
   delimiter. Frames: `delta` (`{ text }`), `message` (the assembled `TUniversalMessage`), `done`,
   `error`. `error` is its own frame rather than a flavour of `done`, so a client cannot mistake a
   failed stream for a finished one — and a stream that ends with no terminal message THROWS, because
   a truncated turn is a failed one, not a short answer. Request validation runs BEFORE the headers
   go out, so a rejected request stays an ordinary `400` with its `rejected` list (CORE-044's rule)
   rather than an error frame inside a `200`.
2. **One spelling: `/api/v1/remote/chat/stream`**, mirroring the non-streaming route it sits beside.
3. **The SERVER assembles.** The handler calls `provider.chat(messages, { …options, onTextDelta })` —
   not a new contract, but the one `IChatOptions.onTextDelta` already places on every provider
   ("stream internally, call this per chunk, and still return the complete assembled message"). So
   tool-call FRAGMENTS never reach the wire, there is one assembler in the world and it is the
   provider's, and the client re-implements nothing.

`RemoteExecutor.executeChatStream` therefore yields ONE message rather than one per delta.
`IExecutor.executeChatStream` yields `TUniversalMessage`, and a partial message is not one; the live
text is what `onTextDelta` carries, which is how the turn has consumed it since CORE-042.

Cancellation is symmetric: the client aborting closes the socket, and the handler aborts the provider
call, so work stops at both ends rather than continuing at the operator's expense.

## The mechanical prevention, which is the part that lasts

Three spellings survived because **no single place could compare them**. `apps/agent-server` is a
server composition root and is forbidden from depending on a remote client (the
`agent-server-boundary` scan says so, and it caught the first attempt at this test), and the reverse
edge is worse. A cross-package invariant that no package may hold is exactly what a harness scan is
for — so `scan-remote-stream-route-spelling` reads both literals from source and compares them.

It carries the floors the harness demands of a new check, which are the reason it is worth anything:
a fixture test that reconstructs the historical `/stream` vs `/chat/stream` disagreement and watches
it go red, a fail-closed classification proven by execution against a bare root, and an exported
examined counter asserted at an exact value twice.

**`createApp({ providers })` now accepts injected providers.** They were built only from environment
API keys, so the route could not be exercised without live credentials — and a route nothing
exercises is how the previous gap survived.

**A stale SPEC corrected along the way.** `packages/agent-remote-client/docs/SPEC.md` still described
streaming as present with the wrong path (`POST /stream`) and the wrong owning file. It had been
wrong since CORE-044 removed the capability, in the opposite direction from the server SPEC.

## Test Plan

Every item met, and the "not a mocked `fetch`" constraint drove where each case lives.

- **The route is registered** — `apps/agent-server/src/__tests__/remote-chat-stream.test.ts`, six
  cases through `supertest` against the REAL app: the SSE frames, the assembled tool call on the
  wire, the SEC-008 auth gate, CORE-044's refuse-rather-than-partially-apply rule, and an unknown
  provider. The first case asserts `status !== 404` explicitly, naming the failure it replaces.
- **The spellings agree** — not a test at all, but `scan-remote-stream-route-spelling`, because the
  two values live in packages that must not import each other. Its own fixture test reconstructs the
  historical disagreement and watches the scan go red on it, in both directions.
- **Cancellation** and **a tool-calling turn end to end** — the user-execution scenario below, over a
  real socket.
- **The inverted assertion** — `remote-executor-simple.test.ts` pinned `executeChatStream` as
  absent; it now pins it present, plus that every delta reaches the caller, that exactly ONE
  assembled message is yielded, and that the whole options object is forwarded. The facade's public
  method enumeration is updated in the same file, which is the second record that would have had to
  be edited to half-restore this.

`agent-remote-client` 105 tests, `agent-server` 51, the scan's fixture 7. Workspace typecheck clean.
`pnpm harness:scan` 124 passed (the new scan registered, its adoption baseline re-frozen in the same
change).

## User Execution Test Scenarios

**Applies**, and it took the second of the two options the item offered: the scenario starts
`apps/agent-server` on a real socket and injects a STUB provider into its provider map, so it needs
no API key and no network — and is deterministic rather than merely runnable. (Probed: no
`ANTHROPIC_*` / `OPENAI_*` / `GEMINI_*` in the environment, no `.env`, no `~/.robota`.) Nothing is
mocked, which is the entire point: a mocked transport agrees with whatever the client says, and that
is what hid this for as long as it lasted.

### Scenario — a remote streaming turn, end to end, over a real socket

**Command:** `cd scratch && node ../node_modules/tsx/dist/cli.mjs --conditions=source src/core-046.ts`

**Evidence:** EXIT:0

```
server listening on http://127.0.0.1:41621/api/v1/remote
deltas received live : ["The ","answer ","is 42"]
messages yielded     : 1
assembled content    : "The answer is 42"
assembled tool call  : [{"id":"c1","type":"function","function":{"name":"lookup","arguments":"{\"q\":\"life\"}"}}]
aborted run rejected : true
provider calls made  : 1
PASS the streaming call reaches a route the server actually serves — it used to be a 404
PASS text deltas arrive LIVE, through the caller's onTextDelta
PASS and there are three of them, not one buffered blob
PASS exactly ONE assembled message is yielded, not one per delta
PASS the tool call that arrives is ASSEMBLED — no fragment leakage across the wire
PASS an aborted streaming run stops rather than completing
PASS and the abort happened before a second provider call was spent
CORE-046 SCENARIO PASS
```

**Red-proof.** Unregister the route and re-run. The scenario does not report failures — it dies, with
the exact error this item exists to end:

```
Error: Remote streaming chat failed (404): {"error":"Not Found",
  "message":"Route POST /api/v1/remote/chat/stream not found", …}
    at executeChatStreamRequest (packages/agent-remote-client/src/client/chat-stream-http.ts:119:15)
    at RemoteExecutor.executeChatStream (packages/agent-remote-client/src/client/remote-executor-simple.ts:175:22)
```

**Cleanup:** the scenario closes its own server and binds port 0, so it leaves nothing listening.
