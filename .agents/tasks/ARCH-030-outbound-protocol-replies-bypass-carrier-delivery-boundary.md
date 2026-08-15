---
title: 'ARCH-030: outbound protocol replies bypass the carrier delivery boundary'
status: todo
created: 2026-08-16
priority: critical
urgency: now
area: packages/agent-transport-protocol, packages/agent-transport-ws, packages/agent-transport-webrtc
depends_on: [ARCH-020, ARCH-028]
issue: https://github.com/woojubb/robota/issues/1734
---

# ARCH-030: unify outbound protocol reply delivery

## Problem

`createWsHandler` has two outbound delivery semantics. Session-event subscriptions use a
carrier-safe delivery boundary that reports failures through `onDeliveryError`, while replies to
inbound requests receive the raw carrier `send`. If a command, submit failure, background-log read,
job-group wait, or background-control operation finishes after disconnect, its Promise continuation
can throw from `send`, bypass carrier cleanup, and surface as an unhandled rejection.

The defect reproduces by starting a delayed remote command through a real handler, closing the WS or
WebRTC delivery carrier, and then resolving the command. The reply throws `WebSocket is not open` (or
the equivalent data-channel error), and the delivery-error observer receives nothing.

## Why this is foundational

Guarding one `.then()` callback would leave every sibling reply family and every future asynchronous
reply under the same split semantics. WS-001 previously recorded the same “send throws from a Promise
continuation” failure mode, so this is a recurring protocol-boundary defect rather than a local caller
mistake.

## Direction

- Define one connection-scoped outbound `TServerMessage` delivery boundary in the protocol handler.
- Route parse, query, control, prompt, background, session-event, and asynchronous continuation replies
  through that boundary without duplicating carrier callbacks.
- Keep transport lifecycle cleanup idempotent and isolate delivery-error observer failures.
- Preserve `SessionResumeBridge` sequence/buffer behavior and replay failed frames on the next sink.
- Add delayed-reply-after-disconnect regressions for protocol, WebSocket, and WebRTC carriers, including
  an explicit zero-unhandled-rejection assertion.

## Test Plan

- Protocol RED proof: resolve a delayed command after the injected send starts throwing; current code
  must produce an unhandled rejection and skip `onDeliveryError`.
- Repeat the delayed reply through real `WsSessionDelivery` and the WebRTC pairing/unpaired carrier
  lifecycle; assert one cleanup, one delivery-error notification, and no escaping rejection.
- Cover every Promise-continuation reply family mechanically or through a shared helper contract so a
  new raw-send continuation cannot be added silently.
- Run protocol, WS, WebRTC, browser-client, and resume-bridge suites plus typecheck, build, scenarios,
  `pnpm harness:scan`, and `pnpm harness:verify-like-ci`.

## User Execution Test Scenarios

**Applies.** The change alters runnable behavior of a published SDK surface — `WsTransport` and
`createWsTransport` from `@robota-sdk/agent-transport-ws` — so the gate is a public-SDK example run, not
an engineering check.

**Scenario home decision.** The scenario lives in **`packages/agent-transport-ws`**, which owns the real
`WsSessionDelivery` carrier and a real `ws` socket and currently has **no** scenario script.
`scripts/harness/scenario-owner-map.mjs` takes the FIRST matching script name per package, and
`@robota-sdk/agent-transport` already owns `scenario:verify` for ARCH-020/028
(`examples/verify-session-event-delivery.ts`). Extending that script was rejected: it would re-record
ARCH-028's canonical `examples/scenarios/session-event-delivery.record.json`, replacing evidence for a
completed item with evidence for this one. Adding a second owner package leaves ARCH-020/028's record
untouched and puts the scenario in the package that holds the carrier.

**Surface preference level 1 (self-contained product observables).** No credentials, no external service,
no provider call, no SQLite: the scenario starts a loopback WS server the product itself owns, connects a
real client, and reads exit code plus one JSON line from stdout. Levels 2 and 3 were not needed.

### Scenario 1 — a reply that resolves after the carrier disconnected is reported, not thrown

**Agent-executability decision:** `agent-executable`. Non-interactive, no TTY, no network beyond
`127.0.0.1`. The invocation shape was executed against current `develop` before this section was written
(see RED baseline below), so the command, the module resolution, and the observables are proven real —
only the values change once the boundary lands.

**Prerequisites**

- Node ≥ 22 and `pnpm install` completed at the repo root. `volta` is not required.
- No provider credentials, no `.env`, no network egress. The WS transport auto-mints its own admission
  token (`WsTransport.resolvedToken`) — the scenario reads it from the object it just constructed.
- Loopback TCP ports `43117`–`43142` available (the scenario binds `43117` with `maxRetries: 25`).
- Artifacts this backlog must create as part of the implementation slice:
  - `packages/agent-transport-ws/examples/verify-outbound-delivery-boundary.ts` — the maintained example.
  - `packages/agent-transport-ws/examples/scenarios/outbound-delivery-boundary.record.json` — canonical
    record, produced by `pnpm scenario:record`.
  - `packages/agent-transport-ws/package.json` scripts:
    - `"scenario:verify": "pnpm exec tsx --conditions=source examples/verify-outbound-delivery-boundary.ts"`
    - `"scenario:record": "node ../../scripts/harness/record-owner-scenario.mjs --scope packages/agent-transport-ws --output examples/scenarios/outbound-delivery-boundary.record.json -- pnpm scenario:verify"`
  - **Dependency to ADD (stated, not discovered later):** `tsx: "^4.23.1"` in
    `packages/agent-transport-ws` `devDependencies`. It currently resolves only by root hoisting;
    `@robota-sdk/agent-transport` declares it explicitly and this package must too. **No other dependency
    is added and no new package edge is created** — `ws`, `@types/ws`,
    `@robota-sdk/agent-interface-transport` (for the `./testing` conformant double) and
    `@robota-sdk/agent-transport-protocol` are already declared. The example imports the package under its
    own name (`@robota-sdk/agent-transport-ws`) via Node self-referencing through `exports`, which is
    verified working under `--conditions=source`; it does not need a self-dependency entry.
- Fixture shape the example must build (no live model, no session store): the conformant
  `createTestInteractiveSession` double from `@robota-sdk/agent-interface-transport/testing`, overriding
  `executeCommand` to (1) signal that it started, (2) await a release gate the scenario controls,
  (3) write a "committed" marker file, (4) resolve — and counting `on`/`off` calls so carrier cleanup is
  externally countable.

**Exact Bash command**

```bash
cd /home/ubunutu/dev/robota-2/packages/agent-transport-ws && pnpm scenario:verify
```

(equivalently, without the package script: `pnpm exec tsx --conditions=source examples/verify-outbound-delivery-boundary.ts`)

**Expected observable result**

- Exit code `0`.
- stdout contains exactly one JSON line. Required substrings:
  - `"scenario":"ARCH-030-outbound-delivery-boundary"`
  - Phase A — real carrier (`WsTransport`, real `ws` server + real client socket, real
    `WsSessionDelivery`): `"carrier":"WsTransport(real ws socket)"`, `"operationCommitted":true`,
    `"cleanupRuns":1`, **`"unhandledRejections":0`**.
  - Phase B — observable carrier (`createWsTransport`, whose `send`/`onDeliveryError` are public options):
    `"carrier":"createWsTransport(observable delivery callbacks)"`,
    **`"deliveryErrors":[{"message":"WebSocket is not open","event":"command_result"}]`** (exactly one
    entry), `"operationCommitted":true`, `"cleanupObserved":true`, **`"latchThrew":null`**,
    `"unhandledRejections":0`.
  - `"cleanupRemoved":true`.
- stderr empty apart from pnpm's own banner.
- Assertion failures are fatal: any mismatch throws with a named message and exits non-zero. The example
  must not soften an assertion to make the run pass.

The four claims map to the four observables: (a) exactly one delivery error → Phase B `deliveryErrors`
length 1 with `event: "command_result"`; (b) the committed operation survives → both phases'
`operationCommitted` (the marker file written by the command after the disconnect);
(c) cleanup exactly once → Phase A `cleanupRuns` from the `on`/`off` listener balance and Phase B
`cleanupObserved` (`transport.onMessage === null`); (d) zero unhandled rejections → both phases'
`unhandledRejections`. `latchThrew: null` additionally pins the §2 latch: a further frame pushed through
the retained `onMessage` after the failure must be dropped silently — neither a second `onDeliveryError`
nor a synchronous throw out of `onMessage`.

**RED baseline captured before implementation (2026-08-16, `main` @ `e828a2925`, same command with the
assertions temporarily relaxed so both phases run to completion):**

```
{"scenario":"ARCH-030-outbound-delivery-boundary",
 "realCarrier":{"carrier":"WsTransport(real ws socket)","operationCommitted":true,"cleanupRuns":1,"unhandledRejections":1},
 "observedCarrier":{"carrier":"createWsTransport(observable delivery callbacks)","latchThrew":"WebSocket is not open","cleanupObserved":false,"operationCommitted":true,"deliveryErrors":[],"cleanupRuns":1,"unhandledRejections":2},
 "cleanupRemoved":true}
```

With the assertions as specified above, the same run on current code exits `1` with
`Error: real carrier produced unhandled rejections: ["WebSocket is not open"]`. Every expected value was
therefore authored against observed-failing behavior, not back-fitted to output.

**Cleanup / reset**

- The example removes its own `mkdtemp` directory in a `finally` block and asserts the directory is gone
  (`"cleanupRemoved":true`).
- Both transports are stopped in `finally` (`WsTransport.stop()` closes the WS server and the HTTP
  listener; the client socket is terminated), so no port stays bound and the process exits on its own.
- Nothing is written inside the repository. No manual reset step is required.

**Evidence (fill in after implementation, before `status: done`):**

- Command run:
- Exit code:
- stdout JSON line:
- Canonical record path + `stdout.sha256`:
- Date / branch / commit:

## Plan

- [ ] Author and approve a BEHAVIOR spec for the single outbound delivery boundary.
- [ ] Plan and gate the public-SDK delayed-reply scenario.
- [ ] Add the protocol RED proof and implement the shared delivery boundary.
- [ ] Wire WS, WebRTC, and resume paths through the boundary with lifecycle regressions.
- [ ] Synchronize package SPECs, README/content guidance, and changesets.
- [ ] Pass completion gates, archive the Task, and close issue #1734.

## Blockers

- ARCH-020 and ARCH-028 must land so the carrier failure lifecycle being unified is stable.

## Result

Pending.
