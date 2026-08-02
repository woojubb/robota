---
title: 'ARCH-011: `ITransportAdapter` is a four-member lifecycle stub, so six transports have each grown a private dialect and nothing mechanical can see the drift'
status: in-progress
created: 2026-08-02
priority: critical
urgency: now
area: packages/agent-interface-transport, packages/agent-transport, packages/agent-transport-http, packages/agent-transport-mcp, packages/agent-transport-ws, packages/agent-transport-tui, packages/agent-transport-webrtc
depends_on: [ARCH-012]
---

# ARCH-011: the transport contract specifies lifecycle and nothing else

## Problem

"Implementing a transport" is an open-ended manual obligation with **no parity check**. Six packages
have each answered the unspecified questions differently, and nothing mechanical can see the drift.
This blocks any new transport and any capability added to the session.

`start()` does not even mean the same thing across implementations: in two of them it runs work to
completion while the registry awaits each one sequentially — so registering either **deadlocks
everything behind it**.

Every other transport-layer finding in the audit — the missing admission boundary (SEC-008),
`ICommandResult`'s English-only failure, the GUI discarding the error channel, and the registry
deadlock — is named by the synthesis as a consequence of this one.

## Evidence

**Layer: L3 (transport).** L3 F1:

- The entire shared contract is `packages/agent-interface-transport/src/transport-adapter.ts:7-12`:
  `{ readonly name; attach(session); start(); stop() }`. It says nothing about what of the session is
  exposed, admission, framing, cancellation or error shape.
- Every implementation therefore returns an intersection with its own extra surface, so no consumer
  can be polymorphic: `agent-transport-http/src/http-transport.ts:20` (`& { getApp(): Hono }`),
  `agent-transport-mcp/src/mcp-transport.ts:24` (`& { getServer(): Server }`),
  `agent-transport-ws/src/ws-transport.ts:20` (`& { onMessage }`),
  `agent-transport/src/headless/headless-transport.ts:22` (`& { getExitCode() }`).
- Measured drift on every omitted axis (L3's table): session surface, admission,
  in-flight-on-disconnect, error shape, cancellation verb — six transports, six answers. The
  capability gap is stated in the code and enforced nowhere:
  `agent-transport-http/src/routes.ts:5-6` — _"Exposes the core session methods (a subset;
  background-task, job-group, and execution-workspace methods are WS-only)."_
- `start()` does not even mean the same thing:
  `agent-transport/src/headless/headless-transport.ts:31-35` runs the entire prompt to completion
  inside `start()` and `agent-transport-tui/src/tui-transport.ts:24-26` blocks for the life of the UI,
  while `TransportRegistry.startAll` awaits each sequentially
  (`agent-transport/src/transport-registry.ts:62-68`) — registering either deadlocks everything
  behind it.

The synthesis re-verified, read-only: `transport-adapter.ts` is exactly the four members quoted.

The cause in one sentence, from the synthesis: _the transport contract specifies lifecycle and
nothing else, so "implementing a transport" is an open-ended manual obligation with no parity check._

## Why this is foundational (or not)

**FOUNDATIONAL.** Single layer (L3), but the synthesis ranks it BLOCKER on blast radius: six
packages, and it is the root of four other transport findings.

**Sequencing, stated by the synthesis:** L3 itself identifies the `IInteractiveSession` god contract
(filed as ARCH-012) as _this_ finding's root — `IInteractiveSession` is the de-facto transport
contract — _"so the two should be sequenced together"_. That is why `depends_on: [ARCH-012]`.

## Direction

The invariant the synthesis states for this class (theme T8): _a port with more than one
implementation needs a shared conformance suite; without one it has as many contracts as it has
adapters._ It lists this finding twice under that theme — six transports with six answers on
admission, cancellation, error shape and session surface with no parity check, and
`ITransportAdapter.start()` meaning "bind" in four implementations and "run to completion" in two.

So the direction the synthesis contains has two parts:

1. **Specify the omitted axes on the contract** — session surface, admission, in-flight-on-disconnect,
   error shape, cancellation verb — rather than leaving each to the implementation. `start()`'s
   meaning is one of them: "bind" and "run to completion" cannot both be `start()` while
   `TransportRegistry.startAll` awaits sequentially.
2. **Add the shared conformance suite** that makes drift visible. The synthesis is explicit that
   without one, the contract has as many meanings as it has adapters.

It does not choose the specific decomposition. The related capability gap it names — HTTP exposing
only a subset of session methods, with background-task/job-group/execution-workspace WS-only
(`routes.ts:5-6`) — is a capability question the new contract has to be able to _ask_, not
necessarily one this work must answer for every transport.

Risk named by the synthesis: the intersection types
(`& { getApp() }`, `& { getServer() }`, `& { onMessage }`, `& { getExitCode() }`) are what consumers
currently depend on, so narrowing the contract without providing the capability-scoped equivalents
breaks every consumer that reaches through them.

## Test Plan

- **Required red-first regression:** a shared conformance suite run against **all six** transports,
  asserting one agreed answer per axis (admission required, cancellation verb, error shape,
  in-flight-on-disconnect, session surface). Against current code this must FAIL for the transports
  that answer differently — it is designed to expose exactly the drift L3's table measured.
- Red-first for the deadlock: register a transport whose `start()` runs to completion
  (`headless-transport.ts:31-35`) together with a second transport, call
  `TransportRegistry.startAll` (`transport-registry.ts:62-68`), and assert the second transport is
  started. Today this hangs.
- A mechanical check that no `ITransportAdapter` implementation returns an intersection type carrying
  extra public surface (the four sites at `http-transport.ts:20`, `mcp-transport.ts:24`,
  `ws-transport.ts:20`, `headless-transport.ts:22`).
- `pnpm typecheck`, `pnpm harness:verify-like-ci` green.

## User Execution Test Scenarios

**Applies — via the public SDK surface.** The delivered change is a published contract an external
consumer implements against; the synthesis's core claim is that this is currently not possible
without private dialects, and the scenario is to do it.

- **Prerequisites:** built workspace and a scratch consumer project depending on the published
  `@robota-sdk/agent-interface-transport` and `@robota-sdk/agent-transport`. This example project does
  not exist today and **will be built by this work**.
- **Steps:**
  1. In the scratch project, implement a minimal custom transport against the published
     `ITransportAdapter` alone — no intersection type, no cast, no reach-through to a concrete class.
  2. Register it in a `TransportRegistry` alongside a shipped transport and start the session.
  3. Submit a prompt through the custom transport, then cancel mid-run, then disconnect while a run
     is in flight.
- **Expected observable result (after the fix):** the custom transport starts (and does not block the
  sibling transport from starting), admits or rejects the submission per the contract's admission
  member, delivers the prompt result, honours the cancellation verb, and produces the contract's
  error shape on disconnect — all without importing anything beyond the contract package.
- **Expected observable result (before the fix, for contrast):** the custom transport cannot express
  admission or cancellation at all (the contract has four members), and registering it after a
  run-to-completion transport never returns.
- **Cleanup:** delete the scratch project.
- **Evidence (fill in after implementation):** the consumer's source (showing no casts), and its
  console output across the three steps.

## Progress

### P1 — `start()` means one thing, and the deadlock is closed

The synthesis lists this finding twice under theme T8, and the second listing is the one with a
runnable failure: `ITransportAdapter.start()` meant "bind" in four implementations and "run to
completion" in two, while `TransportRegistry.startAll` awaited each sequentially. Registering
`headless` or `tui` first meant **every transport behind it never started** — no crash, no error,
never reached.

`start()` now says which it means: it resolves once the transport is SERVING. A transport whose whole
job happens inside `start()` declares `runsToCompletion: true`, and the registry starts it without
awaiting — keeping the promise, not dropping it, so `waitForCompletion()` is where its failure
arrives. `headless-transport` and `tui-transport` declare it.

`runsToCompletion` is optional, and that is a decision rather than an omission: "resolves once
serving" is the ordinary case, so a transport that says nothing is asserting it, and the registry
treats absence as `false` rather than guessing. That is the opposite call from ARCH-012's capability
members, where silence had no safe reading — the difference is stated in the SPEC so the next reader
does not have to infer which rule applies.

Red-proved on both halves, separately: restoring the sequential await fails
`expected 'pending' to be 'settled'`; dropping the promise instead of keeping it fails
`promise resolved "undefined" instead of rejecting`.

### Remaining — the conformance suite and the other axes

The synthesis's direction has two parts and this is the first. What remains:

- **The shared conformance suite** across all six transports, asserting one agreed answer per axis
  (admission, cancellation verb, error shape, in-flight-on-disconnect, session surface). Without it
  the contract still has as many meanings as it has adapters on those axes.
- **The intersection types** (`& { getApp() }`, `& { getServer() }`, `& { onMessage }`,
  `& { getExitCode() }`) that consumers depend on. The synthesis names narrowing them without
  capability-scoped equivalents as the risk, and those equivalents are ARCH-012 P2.
- **The capability gap** — HTTP exposing a subset of session methods, background-task/job-group/
  execution-workspace WS-only. The synthesis says the new contract must be able to ASK this, not
  necessarily answer it for every transport here.
