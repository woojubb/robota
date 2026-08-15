---
title: 'ARCH-030: outbound protocol replies bypass the carrier delivery boundary'
status: done
created: 2026-08-16
completed: 2026-08-16
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
`127.0.0.1`. The invocation shape was executed against `main` @ `e828a2925` before this section was
written — it exited `1` with `Error: real carrier produced unhandled rejections: ["WebSocket is not
open"]` — so the command, the module resolution, and the observables were proven real before any
expectation was set here; only the values change once the boundary lands.

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

**Evidence (2026-08-16):**

- **Command run:** `cd packages/agent-transport-ws && pnpm scenario:verify`
- **Exit code:** `0`
- **stdout JSON line:**

  ```json
  {
    "scenario": "ARCH-030-outbound-delivery-boundary",
    "realCarrier": {
      "carrier": "WsTransport(real ws socket)",
      "operationCommitted": true,
      "cleanupRuns": 1,
      "unhandledRejections": 0
    },
    "observedCarrier": {
      "carrier": "createWsTransport(observable delivery callbacks)",
      "operationCommitted": true,
      "cleanupObserved": true,
      "deliveryErrors": [{ "message": "WebSocket is not open", "event": "command_result" }],
      "latchThrew": null,
      "unhandledRejections": 0
    },
    "cleanupRemoved": true
  }
  ```

- **Every expected observable matched**, each against the RED value recorded before implementation:
  `realCarrier.unhandledRejections` `1 → 0`; `observedCarrier.deliveryErrors` `[] →` exactly one entry
  naming `command_result`; `observedCarrier.cleanupObserved` `false → true`;
  `observedCarrier.latchThrew` `"WebSocket is not open" → null`;
  `observedCarrier.unhandledRejections` `2 → 0`. No expectation was rewritten after the run.
- **Canonical record:** `packages/agent-transport-ws/examples/scenarios/outbound-delivery-boundary.record.json`
  — `status: 0`, `stdout.sha256: 26bbc66703bdc9ba2e7b76d28ca893866ff7c8f380d27d2a7eca3a97491f3bed`,
  `command.rendered: pnpm scenario:verify`.
- **Date / branch:** 2026-08-16 / `fix/arch-030-outbound-delivery-boundary`.

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-08-16

**Status upgrade:** `todo` → `todo` (Stage 1 authorizes implementation to begin; it transitions no
frontmatter status — the terminal status change belongs to Completion Steps after Stage 2).

**Ordering check:** exempt — the gate catalogue's prior-gate map records no prior gate for
`DONE-GATE-STAGE-1`. Write-order was nonetheless confirmed: the scenario section was authored in
`aac4f983d` ("docs(tasks): plan the ARCH-030 delayed-reply scenario"), which precedes every
implementation commit on this branch (`235f4e1cc`, `be8ae6288`, `4555962f9`, `874e793fe`, `c7b3fbfc0`,
`1da64b66c`, `30a2ac51a`), with the evidence field present and empty at write time. No prior
`DONE-GATE-STAGE-1` entry exists in this section — this is the first run.

**Per-criterion evidence:**

- **Fields complete (exact commands, prerequisites, expected observable, evidence field)** — Scenario 1
  carries all four. Command: `cd .../packages/agent-transport-ws && pnpm scenario:verify` (plus the
  script-free equivalent). Prerequisites: Node ≥ 22 + `pnpm install`, no credentials/`.env`/egress,
  loopback ports `43117`–`43142`, the three artifacts to be created, the `tsx: "^4.23.1"` devDependency
  to add, and the `createTestInteractiveSession` fixture shape. Expected observable: exit code `0` and
  one stdout JSON line with named required substrings per phase (`unhandledRejections:0`, a single
  `deliveryErrors` entry for `command_result`, `cleanupObserved:true`, `latchThrew:null`,
  `cleanupRemoved:true`). Evidence field present (authored empty; filled 2026-08-16). A cleanup/reset
  step is also present.
- **Executability decision** — `agent-executable`, stated explicitly with its justification
  (non-interactive, no TTY, no network beyond `127.0.0.1`). Verified by the guard, not taken on claim:
  `pnpm scenario:verify` ran to completion here with `EXIT_CODE=0` and printed exactly the JSON line the
  document records. No `manual-only` label is claimed, so the specific-technical-reason requirement is
  N/A.
- **Drives a product surface** — PASS, not an engineering check. The scenario executes
  `packages/agent-transport-ws/examples/verify-outbound-delivery-boundary.ts`, which imports the
  published entry point `@robota-sdk/agent-transport-ws` by package name (`WsTransport`,
  `createWsTransport`) and drives a real `ws` server + client socket. Confirmed by reading the example's
  imports — no deep internal path, and the observable is product behavior over a live carrier, not a
  build, typecheck, lint, vitest run, `harness:scan`, CI check, or inspection of repository text.
- **Credential / external-service prerequisite stated** — N/A-with-reason, stated explicitly rather than
  left to the executor: "No provider credentials, no `.env`, no network egress", with the admission token
  auto-minted via `WsTransport.resolvedToken`. The one genuine environmental prerequisite (loopback TCP
  `43117`–`43142`) is named up front, so an executor learns the requirement from the scenario.
- **Exception clause** — N/A: no scenario is left unwritten, so the write-is-impossible exception is not
  invoked.

**Notes carried forward (not Stage-1 failures):** (a) the evidence field is already filled, including a
canonical record at `packages/agent-transport-ws/examples/scenarios/outbound-delivery-boundary.record.json`
whose `stdout.sha256` recomputes to the recorded
`26bbc66703bdc9ba2e7b76d28ca893866ff7c8f380d27d2a7eca3a97491f3bed`; the guard's own run reproduced that
output, so the recorded evidence is genuine and not fabricated — judging it remains Stage 2's call.
(b) Scenario 1 covers the WS carrier only; the WebRTC carrier named in `## Direction` is covered by the
engineering `## Test Plan`, which Stage 1 does not gate.

### [DONE-GATE-STAGE-2] — ✅ PASS | 2026-08-16

**Status upgrade:** `todo` → `todo` (Stage 2 authorizes Completion Steps to run; it sets no frontmatter
status itself — the terminal status change and the archival move belong to Completion Steps).

**Ordering check:** PASS. `[DONE-GATE-STAGE-1] — ✅ PASS | 2026-08-16` is recorded in this section with
per-criterion evidence. Expected input state per the gate catalogue's prior-gate map ("scenarios written,
implementation complete") holds: `## User Execution Test Scenarios` carries a fully written Scenario 1,
and `## Plan` has every implementation item `[x]` with only the completion-gate item open. Frontmatter is
`status: todo` in `.agents/tasks/` root — status has not been pre-set to `done` ahead of this gate.

**Per-criterion evidence:**

- **Every scenario directly executed against the completed implementation** — PASS, executed by the guard,
  not accepted on claim. `cd packages/agent-transport-ws && pnpm scenario:verify` was run at current HEAD
  `30a2ac51a`, which is two commits AFTER the record was committed (`c7b3fbfc0`), so the run also proves the
  later `1da64b66c`/`30a2ac51a` refactors did not regress the observable. `EXIT_CODE=0`. Scenario 1 is the
  only scenario in this section; there is no unexecuted scenario.
- **Observed result matched the expected observable result** — PASS, every named observable, not a summary.
  Exactly one stdout JSON line; `realCarrier`: `"carrier":"WsTransport(real ws socket)"`,
  `operationCommitted:true`, `cleanupRuns:1`, `unhandledRejections:0`; `observedCarrier`:
  `"carrier":"createWsTransport(observable delivery callbacks)"`, `operationCommitted:true`,
  `cleanupObserved:true`, `deliveryErrors` exactly one entry
  `{"message":"WebSocket is not open","event":"command_result"}`, `latchThrew:null`,
  `unhandledRejections:0`; `cleanupRemoved:true`. stderr held only pnpm's own `pnpm.overrides` banner, as
  the scenario allows. The guard's normalized stdout is **byte-identical** to the recorded
  `stdout.normalized`, and `sha256(stdout.normalized)` recomputes to the recorded
  `26bbc66703bdc9ba2e7b76d28ca893866ff7c8f380d27d2a7eca3a97491f3bed` — the recorded evidence is reproducible,
  not transcribed. Expectation-rewriting was checked and not found: assertions in
  `examples/verify-outbound-delivery-boundary.ts` are fatal `throw`s pinning the exact values
  (`rejections.length === 0`, `deliveryErrors.length === 1`, `deliveryErrors[0].event === 'command_result'`,
  `cleanupObserved`, `latchThrew === null`), so a mismatch exits non-zero rather than printing a softer line.
- **Concrete evidence recorded under the scenario's evidence field** — PASS. The `**Evidence (2026-08-16):**`
  block under Scenario 1 carries the command run, exit code `0`, the full stdout JSON line, the per-value
  RED→GREEN deltas (`unhandledRejections` `1→0` and `2→0`, `deliveryErrors` `[]→` one `command_result` entry,
  `cleanupObserved` `false→true`, `latchThrew` `"WebSocket is not open"→null`), the canonical record path,
  and date/branch.
- **Engineering verification cited as evidence (FAIL check)** — clean. The evidence block cites only the
  product-surface run and its canonical record. No build, typecheck, lint, vitest, `harness:scan`,
  `harness:verify-like-ci`, or CI output appears as gate evidence; those remain confined to the engineering
  `## Test Plan`, where they belong.
- **Unprobed capability-absence claim (FAIL check)** — N/A, and not by omission: no capability-absence
  exception is invoked anywhere in the section. The prerequisite statement is affirmative ("no provider
  credentials, no `.env`, no network egress"; admission token auto-minted via `WsTransport.resolvedToken`)
  and was proven by execution — the guard's run succeeded with no credentials supplied.
- **Durable repository artifacts (code-changing item)** — PASS, each referenced path verified present:
  `packages/agent-transport-ws/examples/verify-outbound-delivery-boundary.ts`,
  `packages/agent-transport-ws/examples/scenarios/outbound-delivery-boundary.record.json`,
  `packages/agent-transport-protocol/docs/SPEC.md`,
  `.changeset/arch-030-outbound-delivery-boundary.md`, and the declared
  `scenario:verify` / `scenario:record` scripts plus `tsx: "^4.23.1"` in
  `packages/agent-transport-ws/package.json`.
- **Exception clause** — N/A: execution was possible and performed, no scenario is labeled `manual-only`,
  so the execution-is-impossible exception is not invoked.
- **Mechanical floors** — all three green at HEAD: `check-done-evidence.mjs` exit `0`
  ("done-evidence scan passed (14 superseded reference(s))"), `check-backlog-placement.mjs` exit `0`,
  `scan-capability-reachability.mjs` exit `0`.

**Not verified (out of this gate's reach, not counted as evidence):** the RED baseline attributed to `main`
@ `e828a2925` was not reproduced — doing so needs a working-tree checkout the guard may not perform. It is
supporting narrative; the verdict rests on the GREEN run above.

## Plan

- [x] Author and approve a BEHAVIOR spec for the single outbound delivery boundary — the recommendation
      went through two independent review rounds (`REVISE` → `ENDORSE`, 2026-08-16); the boundary's
      contract now lives in `packages/agent-transport-protocol/docs/SPEC.md`.
- [x] Plan and gate the public-SDK delayed-reply scenario — written before implementation
      (`aac4f983d`), `DONE-GATE-STAGE-1` PASS 2026-08-16.
- [x] Add the protocol RED proof and implement the shared delivery boundary — `createOutboundDelivery`
      plus `src/__tests__/outbound-delivery.test.ts` covering all eleven reply families, the latch, and
      the `@ts-expect-error` type floor.
- [x] Wire WS, WebRTC, and resume paths through the boundary with lifecycle regressions —
      `WsSessionDelivery` (raw sink now private), `createWsTransport`, `PairingGate`,
      `WebRtcTransport`, and `SessionResumeBridge` (per-attachment boundary), each with a carrier
      regression.
- [x] Synchronize package SPECs, README/content guidance, and changesets — the three transport SPECs and
      `.changeset/arch-030-outbound-delivery-boundary.md` (protocol `major`, ws/webrtc `patch`).
- [x] Pass completion gates, archive the Task, and close issue #1734.

## Blockers

- None. ARCH-020 and ARCH-028 both landed (PR #1735) before this item started, so the carrier failure
  lifecycle being unified was already stable.

## Result

One connection-scoped outbound delivery boundary now carries every outbound `TServerMessage` on a
connection — the session-event fan-out and all eleven reply families alike. The **carrier** builds it
from its own sink and its own failure policy and passes it down; `TOutboundDeliver` is branded and
`createOutboundDelivery` is its only producer, so a raw `send` is refused by the compiler wherever a
boundary is required, and `WsSessionDelivery`'s raw sink is private with `deliver` as its only public
exit. A reply that resolves after a disconnect is now reported once through the carrier's own cleanup
instead of escaping as an unhandled rejection.

Two corrections to this item's own text, both confirmed by independent review: the WebRTC path named
here was already guarded through `SessionResumeBridge` — the unguarded WebRTC exposure was the bare
`createWsHandler` the pairing gate and transport build when no resume bridge is supplied; and six
SYNCHRONOUS reply families escaped too, throwing into the carrier's inbound listener rather than as
rejections, so guarding only the five Promise continuations the title names would have left them.

Verification: `harness:verify-like-ci` PASS (12/12 stages), transport suites 204 green, the
user-execution scenario green with both done-gate stages independently PASSed, and the pre-PR review's
own worktree run at the merge base reproducing the RED baseline byte for byte.

Three review findings were upheld and fixed rather than argued away — the bridge held its channel in a
closure `dispose()` never cleared, the scenario's latch observable measured a property the cleanup had
already nulled, and no commit was typed `fix:` so the repository's regression red-proof floor had never
evaluated this defect fix. The floor now runs and returns `red-proof-ok`.
