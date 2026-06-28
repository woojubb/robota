---
status: draft
type: INFRA
tags: [transport, testing]
---

# INFRA-019: Programmatic in-process agent driver (IInteractionChannel adapter)

Final TEST-008 increment. Adds a **programmatic `IInteractionChannel` adapter** and a thin
**in-process driver** so the real agent can be driven structurally — send a message, await the turn,
read assistant replies / tool calls / errors as data — with no terminal, no PTY, no scraping. This
closes the north star: "the agent can be driven at will, in-process, structured."

## Problem

The framework already exposes the binding seam — `createInteractiveRuntime({ channel, ... })` consumes
any `IInteractionChannel` and wires it to a real `InteractiveSession` (real provider, real command
modules, real tool loop). Two adapters exist today:

- `TuiInteractionChannel` (agent-transport-tui) — Ink/React, direct-wiring, terminal-bound.
- `HeadlessInteractionChannel` (agent-transport) — one-shot print runner, not interactive-structured.

There is **no programmatic adapter** — nothing that lets a caller (a test, an automation, an embedding
app) push a message in-process and read back the structured `InteractionEvent` stream the contract
already defines. The `requestAction` contract doc explicitly reserves a "programmatic preset" adapter
slot for exactly this. Until it exists, driving the agent requires a terminal (PTY scraping, INFRA-018)
— the slowest, least structured form.

Reproduction: there is no way, in a unit test or an embedding host, to do
`driver.send('hi'); const reply = driver.lastAssistantText();` against the real framework session.

## Architecture Review

### Affected Scope

- `packages/agent-transport/src/programmatic/` — NEW: `ProgrammaticInteractionChannel` (implements
  `IInteractionChannel` via the documented one-way `write()` event protocol + an action-response
  queue) and `createProgrammaticAgent` (wraps `createInteractiveRuntime` + the channel; exposes
  `start/send/stop` + structured accessors).
- `packages/agent-transport/src/index.ts` — export the adapter + driver; add a `./programmatic`
  subpath in `package.json` exports.
- `packages/agent-transport/src/__tests__/programmatic/` — NEW: an in-process test using the
  deterministic scripted provider (`@robota-sdk/agent-core/testing`) proving structured driving
  against the REAL `InteractiveSession` (no mocks of the framework loop).

agent-transport already depends on exactly the right packages (agent-core, agent-framework,
agent-interface-transport) — no new dependency.

### Alternatives Considered

**Alt A (chosen): programmatic adapter + thin driver over `createInteractiveRuntime`, in agent-transport**

- Pro: smallest correct seam — reuses the existing port (`IInteractionChannel`) and the existing
  binding (`createInteractiveRuntime`). The driver is a thin convenience over the production
  event protocol; no framework change. Lives in transport core (production), so the (future) testing
  package consumes it test→production, never the reverse.
- Con: the driver awaits turn completion via the event stream / `submit()` resolution; multi-call
  turns (tool loops) are naturally handled by `submit()` awaiting the whole turn.

**Alt B: a full transport-agnostic CLI assembly factory (`createCliAgent`) extracted from agent-cli**

- Pro: production-parity wiring (exact preset/provider/command composition the CLI uses) reusable
  in-process.
- Con: an invasive refactor of the CLI startup path; **not required** to close the north star — the
  programmatic driver already drives the real framework session with real command modules and a real
  provider. Sequenced to a follow-up backlog item, not dropped.

### Decision

Alt A. Ship the programmatic adapter + in-process driver in agent-transport, proven against the real
`InteractiveSession` with the scripted provider. The CLI assembly-factory extraction (production-parity
in-process wiring) is sequenced to a follow-up (recorded in the backlog), not in scope here.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — agent-transport (adapter + driver + test); no new deps
- [x] Sibling scan 완료 — `createInteractiveRuntime` is the sole channel-binding seam; existing
      adapters (Tui/Headless) confirm the port shape; the programmatic slot is reserved by the contract
- [x] 대안 최소 2개 검토 완료 (A thin driver over the port / B full CLI assembly-factory extraction)
- [x] 결정 근거 문서화 완료 (smallest correct seam, reuses port + binding, production placement, test→prod)

## Solution

1. **`ProgrammaticInteractionChannel implements IInteractionChannel`** (agent-transport/programmatic):
   - `onSubmit(handler)` stores the framework's submit handler; `submit(text)` invokes it (the
     programmatic "user types").
   - `write(event)` appends to an in-memory `InteractionEvent[]` log (the structured output).
   - `requestAction(action)` resolves from a FIFO queue of pre-supplied `TActionResponse`s; if the
     queue is empty it resolves `{ type: 'cancelled' }` (a safe default the framework already handles)
     — so a driver run never blocks on an un-answered disambiguation.
   - `setAvailableCommands`/`setBusy`/`start`/`stop` track simple state (`availableCommands`, `busy`,
     `started`/`stopped`).
2. **`createProgrammaticAgent(options)`** — wraps `createInteractiveRuntime({ channel, commandModules,
provider, cwd, sessionStore })`:
   - `start()` → `runtime.start()`.
   - `send(text)` → `await channel.submit(text)` (resolves when the turn completes, since
     `InteractiveSession.submit` awaits the whole turn; busy is cleared on `complete`).
   - structured accessors: `events` (the full `InteractionEvent[]`), `assistantReplies()`
     (`assistant-done` fullTexts), `lastAssistantText()`, `toolCalls()` (`tool-call` events),
     `errors()`.
   - `queueAction(response)` to pre-answer the next disambiguation.
   - `stop()` → `runtime.stop()`.
3. **Exports** — add `ProgrammaticInteractionChannel`, `createProgrammaticAgent`, and their option/types
   to agent-transport's index + a `./programmatic` subpath.
4. **In-process test** — with `createScriptedProvider([...])` and a temp cwd, build the driver, `start`,
   `send` a message, and assert the recorded assistant reply is captured as structured data; cover a
   tool-call turn and a queued `requestAction`. The framework loop (session, tool exec, persistence)
   runs unmocked.

## Affected Files

- `packages/agent-transport/src/programmatic/ProgrammaticInteractionChannel.ts` (NEW)
- `packages/agent-transport/src/programmatic/createProgrammaticAgent.ts` (NEW)
- `packages/agent-transport/src/programmatic/index.ts` (NEW)
- `packages/agent-transport/src/index.ts`, `packages/agent-transport/package.json` (export + subpath)
- `packages/agent-transport/src/__tests__/programmatic/programmatic-driver.test.ts` (NEW)
- `packages/agent-transport/docs/SPEC.md` (document the new programmatic surface)
- `packages/agent-framework/src/interaction/createInteractiveRuntime.ts` — added `permissionMode` to
  `IInteractiveRuntimeOptions` (parity with TUI/headless) and made `assistant-done` carry the
  authoritative `result.response` (correct for non-streaming providers). Scope note appended at
  GATE-VERIFY — a justified, minimal framework change surfaced during implementation, not a new design.

## Completion Criteria

- [x] TC-01: `createProgrammaticAgent({ provider: scripted, cwd })` starts and binds a real
      `InteractiveSession` via `createInteractiveRuntime` (no mocks of the framework loop).
- [x] TC-02: `await driver.send('hello')` drives a real turn; the scripted assistant reply is captured —
      `driver.lastAssistantText()` equals the scripted text and `driver.events` contains the
      `user-message` then `assistant-done` events in order.
- [x] TC-03: a tool-call turn is captured as structured data — `driver.toolCalls()` contains the `Edit`
      tool-call event and the real tool loop mutated the file on disk (not mocked).
- [x] TC-04: `channel.queueAction({...})` pre-answers a disambiguation `requestAction`; with an empty
      queue, `requestAction` resolves `{ type: 'cancelled' }` (driver never deadlocks).
- [x] TC-05: `pnpm --filter @robota-sdk/agent-transport typecheck` + `build` exit 0; agent-transport
      suite 38 pass; framework suite 1021 pass; `pnpm harness:scan` 33/33 (incl. dependency-direction +
      capability-placement + docs-structure for the new subpath).

## Test Plan

Test strategy derived from type=INFRA, tags=[transport,testing]: in-process functional tests against
the real framework loop with a deterministic provider + harness scans.

| TC-ID | Test Type | Tool / Approach                                                            | Notes                               |
| ----- | --------- | -------------------------------------------------------------------------- | ----------------------------------- |
| TC-01 | automated | vitest: build driver with scripted provider + temp cwd, assert start binds | Real `InteractiveSession`, no mocks |
| TC-02 | automated | vitest: `send` a message, assert captured assistant reply + event order    | Structured in-process driving       |
| TC-03 | automated | vitest: scripted tool-call turn, assert `toolCalls()` captured             | Real tool loop                      |
| TC-04 | automated | vitest: queued + empty `requestAction` → resolved / cancelled              | No deadlock on disambiguation       |
| TC-05 | automated | `pnpm typecheck` + `build` + `pnpm harness:scan`                           | Must exit 0 / all scans green       |

## User Execution Test Scenarios

- Prereq: agent-transport built; a deterministic provider (the scripted provider, or a real provider
  key for a live run).
- Steps (in-process, e.g. a Node script or test):
  `const driver = createProgrammaticAgent({ provider, cwd, commandModules }); await driver.start();
await driver.send('hello'); console.log(driver.lastAssistantText()); await driver.stop();`
- Expected: the assistant reply prints with no terminal/PTY involved; `driver.events` holds the full
  structured `InteractionEvent` stream (user-message, assistant chunks/done, tool calls) for assertion.
- Evidence: `programmatic-driver.test.ts` is the automated form of this scenario — it constructs the
  driver, `start()`s it, `send()`s a message, and asserts `lastAssistantText()` / `events` /
  `toolCalls()` against the real framework loop (scripted provider) with no terminal. TC-01/02 prove the
  send→reply round-trip; TC-03 proves a tool turn mutates a real file and surfaces as data; all 3 pass.

## Tasks

- [x] `.agents/tasks/completed/INFRA-019.md` — archived (GATE-COMPLETE).

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-06-28

- Frontmatter `type: INFRA`, `tags: [transport, testing]`; Problem w/ reproduction; Architecture
  Review 4/4 — 2 alternatives (A thin driver over the port / B CLI assembly-factory) + decision;
  TC-01–05 + matching Test Plan; Tasks placeholder; empty result Evidence Log.
- Result: PASS → `draft` → `review-ready` → `backlog/`.

### [GATE-APPROVAL] — ✅ PASS | 2026-06-28

- User authorized driving the final TEST-008 increment to completion ("이어서 끝까지 진행해", following
  the offer to take INFRA-019 — the programmatic adapter — to close "마음대로 제어"). Scoped (engineering
  decision, stated to the user) to the programmatic adapter + in-process driver; the CLI
  assembly-factory extraction is sequenced to a follow-up backlog item, not dropped.
- No Architecture Review / type / tags changed after approval.
- Result: PASS → `review-ready` → `approved` → `todo/`.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-06-28

- Tasks file `.agents/tasks/INFRA-019.md` created; T1–T4 map to TC-01–05.
- Result: PASS → `approved` → `in-progress` → `active/`.

### Implementation note (2026-06-28)

Two minimal `createInteractiveRuntime` (agent-framework) changes surfaced during implementation —
justified, not new design:

1. **`permissionMode` on `IInteractiveRuntimeOptions`** — the production runtime path created the
   session without a permission mode, so a programmatically-driven tool turn (TC-03) could not run
   tools deterministically. Added the option (parity with the TUI/headless channels) and threaded it
   to the `InteractiveSession`; the driver exposes it as `permissionMode`.
2. **`assistant-done` carries `result.response`** — the event previously reported only the accumulated
   `text_delta` stream, which a non-streaming provider (the scripted provider) does not fully emit
   (TC-02/03 saw `''`/`'\n\n'`). It now prefers the authoritative `result.response` from the execution
   result, falling back to the deltas. Correct for both streaming and non-streaming providers; the
   existing `createInteractiveRuntime` tests (which emit `response` on `complete`) stay green.

### [GATE-VERIFY] — ✅ PASS | 2026-06-28

- Prior gate: GATE-IMPLEMENT ✅ PASS; status `in-progress` in `active/`.
- T1–T4 complete; agent-transport typecheck + build exit 0 (new `programmatic/index` entry emitted);
  agent-transport suite 38 pass (3 new INFRA-019 tests); agent-framework suite 1021 pass (runtime
  change regression-clean); framework lint 0 errors; `pnpm harness:scan` 33/33.
- Result: PASS → `in-progress` → `verifying`.

### [GATE-COMPLETE] — ✅ PASS | 2026-06-28

- **TC-01** ✅ `createProgrammaticAgent` binds a real `InteractiveSession` via `createInteractiveRuntime`
  (no framework-loop mocks) and starts.
- **TC-02** ✅ `send('hello')` → `lastAssistantText()` = `'DRIVEN_ANSWER_42'`; `events` carry
  `user-message` before `assistant-done`; scripted provider saw the driven message.
- **TC-03** ✅ scripted `Edit` turn ran the real tool loop (file mutated `Hello`→`Goodbye` on disk) and
  surfaced in `toolCalls()`; final reply `'edit done'`.
- **TC-04** ✅ queued `confirm` answered; empty queue resolved `{ type: 'cancelled' }` (no deadlock).
- **TC-05** ✅ transport typecheck + build exit 0; transport 38 pass; framework 1021 pass;
  `harness:scan` 33/33.

All Completion Criteria `[x]`; every Test Plan row has a test reference. Tasks archived to
`.agents/tasks/completed/INFRA-019.md`. Result: PASS → `verifying` → `done`; `active/` → `done/`.

**TEST-008 north star closed.** The agent can now be driven at will across all three axes: the replay
provider (INFRA-017), the CLI `--session-log` flag (INFRA-018), and the in-process programmatic driver
(INFRA-019). Sequenced follow-up: the transport-agnostic CLI assembly factory (`createCliAgent`) for
production-parity in-process wiring — recorded in the backlog, not required to close the north star.
