---
title: 'CORE-044: the remote provider seam implements none of the IChatOptions contract at either end — the client sends no options, the server drops the `tools` the client does send so a remote agent silently has NO TOOLS, and the streaming client posts to a route the server does not serve, spelled two different ways'
status: todo
created: 2026-08-16
priority: critical
urgency: soon
area: packages/agent-remote-client, apps/agent-server
depends_on: [CORE-042]
---

# CORE-044: the remote seam implements none of the contract it declares

Found while planning [CORE-042](completed/CORE-042-the-execution-turn-is-implemented-twice.md), which made the
gap load-bearing: once the streaming entry becomes an adapter over the round path, a remote provider
that ignores `signal` is a turn that cannot be cancelled.

## Problem

`IChatOptions` carries `signal`, `onTextDelta`, `toolChoice`, `maxTokens`, `temperature` and `effort`.
The remote provider seam implements **none** of it, at **both** ends — and the damage is worse than
options.

### The server silently discards the agent's tools

`apps/agent-server/src/app.ts:121` destructures `{ provider, messages, model }` and `:138` calls
`provider.chat(messages, { model })`. The client **does** send `tools`
(`chat-http-methods.ts:99-104`) — the server never reads them. So **a remote-executor agent has no
tools at all**, and nothing anywhere says so: the model simply never calls one. The BYOK handler
(`:147-193`) has the identical shape.

That is the same silent-drop failure class CORE-042 exists to end, at a different seam, and it is
user-facing: an agent configured with tools appears to work and quietly cannot act.

### There is no streaming route in this repository

The server's entire route table is `remote/health`, `remote/chat`, `byok/chat`, `/`,
`remote/ws/status`, `/health`, and the playground router. There is **no** stream route. Meanwhile:

- `chat-http-methods.ts:174` posts to `${baseUrl}/stream`,
- `request-handler-simple.ts:47-48` names a third spelling, `/chat/stream`,
- `app.ts:111` and `apps/agent-server/docs/SPEC.md:31` both claim "Provider chat/stream routes are
  inlined" — only the chat route actually was.

So the streaming client points at an endpoint that does not exist, under two spellings, while the
documentation asserts it does.

### And every per-call option is dropped, in both directions

- **Client.** `SimpleRemoteExecutor.executeChat`
  (`packages/agent-remote-client/src/client/remote-executor-simple.ts:110-124`) calls
  `httpClient.chat(messages, provider, model, request.tools)`, and `HttpClient.chat`
  (`client/http-client.ts:71-86`) has **no options parameter at all**. The body is
  `{ messages, provider, model, tools }`; `fetch` is called with no `signal` (`:108-118`).
- **Server.** As above — even if the client sent them, the handler would drop them.

`LocalExecutor` forwards `request.options` correctly
(`agent-core/src/executors/local-executor.ts:104-108`), so this is the remote path specifically, not
the executor contract.

## What each dropped thing costs

- **`tools`** — the agent cannot act. Silent, and the most serious of these.
- **`signal`** — the remote path is **uncancellable**: the same class as CORE-018 (fixed for the
  streaming path) and RUNTIME-004, on a seam neither covered.
- **`toolChoice`** — CORE-017's forcing directive is silently ignored; `'required'` and a named tool
  degrade to `'auto'` with no signal to the caller.
- **`maxTokens` / `temperature` / `effort`** — CORE-016's run-scoped options are silently ignored, the
  same defect CORE-016 fixed on the streaming path.
- **`onTextDelta`** — a function cannot cross a wire; restoring live deltas needs a streaming route
  that does not currently exist.

**Nothing tests any of this.** That is the mechanism, not an aside: the seam declares a contract, no
test asserts the contract at the boundary, and each dropped member was found only by reading.

## Why this is not part of CORE-042

Both halves were considered for that unit and split out on the reviewer's ruling, for reasons of
correctness and size rather than authority:

1. **The streaming route does not exist**, so routing `executeChat` to it would turn a working remote
   `run()` into a 404. That alone settles it.
2. **The delta predicate is not narrow either.** `execution-round-streaming.ts:80-88` passes
   `onTextDelta` **unconditionally on every round-path provider call**, not gated on the caller
   supplying one. So "route to the streaming surface when a delta callback is present" would move
   **100% of remote traffic, including every plain `run()`**, onto it — a transport migration, not a
   narrow restoration.
3. **It needs an assembler CORE-042 deletes.** `remote-executor-simple.ts:166` says so itself —
   _"yield every chunk as-is (ExecutionService merges them)"_ — and the merger is the tool-call
   fragment accumulator CORE-042 removes with `execution-stream.ts`. Porting that into the remote
   client, against a fragmentation behaviour that cannot be observed in-repo, risks silently corrupting
   tool calls: the same silent-failure class CORE-042 exists to end.
4. CORE-042 already exceeds the soft PR ceiling, and this work must additionally design the wire
   representation of the options, decide whether a streaming route is implemented at all, and pick a
   transport for it (SSE or chunked) — a unit of its own, not a loose end of another.

CORE-042 does land the one piece that is genuinely client-local and that its own cancellation claim
depends on: `signal` threaded into `fetch`.

**Accepted in the meantime, stated rather than discovered:** on the remote seam `runStream()` yields
one terminal chunk rather than live deltas — which is exactly what `run()` does there today, so it is
not a regression.

## Not an owner decision

An earlier framing reserved the wire-schema half for the owner as "an externally visible contract".
**That is withdrawn.** It is agent-authority work like any other. Both ends are in this repository, no stable version has been released, the
current beta is not distributed, and the rules forbid keeping legacy or compatibility code
(`code-quality.md:50` — _"unreleased — no backward-compat constraint"_). The reservation in
`backlog-execution.md` § Agent Decision Authority exists for coordination cost with parties who cannot
be updated; here there are none.

## Direction

Make the remote seam implement the contract it declares, and prove it at the boundary. Carry
`IChatOptions` end to end. The client sends the serializable options in the POST body and threads
`signal` into `fetch`; the server handler forwards them into `provider.chat`. `onTextDelta` is handled
by routing to the streaming surface and assembling client-side — which is only safe once the fragment
assembly it depends on has an owner, so sequence it after CORE-042 lands.

The `/chat` and `/chat/stream` bodies should carry the options as one object rather than as parallel
top-level fields, so a future option does not require touching both ends again — the parallel-collection
failure mode `code-quality.md` names.

## Test Plan

- **The tools regression first, red:** a remote-executor agent with a registered tool reaches the
  provider with that tool. It does not today.
- Either implement the streaming route or delete the client that posts to it — a client calling an
  endpoint nobody serves, under two spellings, with the SPEC claiming otherwise, is worse than either.
- Client: the POST body carries `toolChoice`/`maxTokens`/`temperature`/`effort` when the caller sets
  them, and `fetch` receives the run's `signal` (the existing `vi.mock('../http-client')` seam in
  `remote-executor-simple.test.ts` covers the first half).
- Server: the handler forwards the received options into `provider.chat`, asserted with a recording
  provider.
- An aborted remote run rejects rather than running to completion.
- A remote run with `toolChoice: 'required'` reaches the provider with that directive.
- `pnpm harness:verify-like-ci` green.

## User Execution Test Scenarios

To be authored when this item is picked up. The client half is `agent-executable` and provider-free
(observe the request the client builds); the end-to-end half needs `apps/agent-server` running locally,
which the work can start as part of the scenario.
