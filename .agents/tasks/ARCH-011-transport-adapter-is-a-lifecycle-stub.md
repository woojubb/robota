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

### Review round — the failure route nothing could call

Two MUSTs, both measured, and the second is this session's recurring class in a new shape.

1. **`waitForCompletion()` was on the concrete registry only.** Both production `startAll` callers
   hold `ITransportRegistryView`, which did not declare it, so neither could call it — and neither
   did. The failure of a run-to-completion transport was stored in a map nothing could read, which is
   WORSE than before, where `startAll` awaited it and the error reached the caller. It is on the view
   now, and `IRuntimeHostHandle` exposes it to the caller that owns the process-lifetime wait.
2. **Holding a promise is not handling it.** `this.running.set(name, transport.start())` keeps a
   reference and attaches nothing, so a rejection between `startAll` returning and the caller reaching
   `waitForCompletion` is an unhandled rejection — measured as exit code 1, bypassing shutdown. My
   JSDoc and the SPEC both asserted the opposite. The handler is attached at start time now and the
   outcome replayed, and the existing test could not have caught it because it awaited the two back to
   back and never left the microtask drain. The new case puts a macrotask between them.

Also: `stopAll` ignored the tracking entirely, so it reported success over live work and a subsequent
`waitForCompletion` would hang on a transport whose `stop()` is a documented no-op. It abandons them
explicitly, which is what makes its bounded best-effort contract honest — and what lets a session
switch start from empty rather than overwrite a promise that then has no handler.

CI review round: two more, and the first is the same class again.

**A failure from a STOPPED session leaked into the next one.** `stopAll` emptied the failure array in
place, but the handler attached to a still-in-flight `start()` cannot be detached — it fires after the
stop and writes to whatever array it captured, which was the same instance the next session read. So
"a later `startAll` starts from empty", which I had written into the code and the SPEC, was not true.
The array is REPLACED now and the handler captures its own generation, so a stale write lands where
nobody reads. The earlier stop case only exercised the resolve path; the new one rejects after the
stop, and red-proves.

**And the new route still had no production caller.** `serve-mode` — the `--serve` process-lifetime
waiter — awaited signals alone. Exposing `IRuntimeHostHandle.waitForCompletion()` without anything
racing it is the same shape this branch fixed at the registry layer, one level up. It races it now;
no run-to-completion transport is registered there today, and the wire is what stops that from
mattering later.

Second CI round, three more — and the first was a regression I introduced while fixing the previous
round's SHOULD.

**`--serve` tore itself down one microtask after it started serving.** Wiring
`host.waitForCompletion()` into the process-lifetime wait, I settled on RESOLUTION as well as
rejection. `waitForCompletion` resolves immediately when there is nothing to wait for, which is the
ordinary case for `--serve` — so every ordinary run ended instantly. Only a FAILURE settles it now:
`--serve`'s whole job is to stay alive until a signal or a host-executed exit. The binary e2e caught
it (`serve host did not come up within 20000ms`), and that is the second time in this branch a fix
for a review finding introduced a worse defect than the finding.

**A stale settle deleted the CURRENT session's entry.** `this.running.delete(name)` keyed on the
transport name with no ownership check, so a promise abandoned by `stopAll` could, on settling late,
delete the entry a NEW session had put under the same name — and `waitForCompletion` would then
resolve without waiting for work still in flight. The previous case covered the opposite ordering
only. Same `if (current === ours)` check `TurnClaim.release` needed in RUNTIME-003.

**A rejection with no value was read as no failure.** `Promise.reject()` pushes `undefined`, and the
`!== undefined` guard swallowed it. Presence, not equality.

Third CI round, two SHOULDs, both about completeness rather than correctness.

`agent-framework` was missing from the changeset although its public `IRuntimeHostHandle` gained a
required member. Added.

And the sharper one: **the failure route's real reach is narrower than the narrative.** `headless` —
the transport that most obviously runs to completion — absorbs every failure inside its runner and
always resolves, expressing failure through `getExitCode()`. So its actual failure mode does not
reject and therefore never reaches `trackRunToCompletion` → `waitForCompletion` → serve-mode's
`.catch`. The new tests use a synthetic `start()` that throws, which is a different shape from the
one production has. The machinery is right for what it covers; the prose implied it covered more.
Both SPEC and the transport header now say which channel carries what.

**Open question recorded rather than answered:** should a run-to-completion transport be able to
report failure BY RESULT (a non-zero exit code) as well as by rejection? Making `waitForCompletion`
observe exit codes would change `headless`'s deliberate black-box contract (RUNTIME-001), so it is a
design decision for the conformance-suite work, not a patch here.
