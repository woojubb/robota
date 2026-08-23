---
title: 'ARCH-019: the sanctioned session double reuses one turn identity across distinct submissions'
status: done
created: 2026-08-13
completed: 2026-08-14
priority: medium
urgency: soon
area: packages/agent-interface-transport, packages/agent-framework
depends_on: []
---

# ARCH-019: the sanctioned session double collapses distinct submissions into one identity

## Current finding-depth disposition

- **LOCAL:** the default double returns `turnId: 'test-turn'` for every submission. This Task owns
  the per-call deterministic identity fix and its public testing-subpath proof.
- **INVALID:** the original claim that transport-facing `getSession()` must expose
  `getEventService()`. The framework caller is typed against concrete `Session`; transport-typed
  production consumers use only `getSessionId()`. The contract stays narrow. The extra defensive
  stub may be removed as local cleanup, without widening the public contract.

The historical report below is preserved as provenance; its first numbered claim is not current
acceptance scope.

## Problem

Two fidelity defects in the contract that ARCH-012 made the SSOT double for:

1. `IInteractiveSession.getSession()` is typed to return `{ getSessionId(): string }`, but the
   framework runtime reaches past it (`getEventService()`), and the "conformant" test double has to
   ship an off-contract `getEventService` stub to survive — so the declared surface understates what
   the ecosystem requires, and the double's own compiler-guarantee ("refuses the moment the contract
   gains a member") does not cover this drift channel (structural typing accepts extra members).
2. The sanctioned double mints one fixed `turnId` (`'test-turn'`) for every submission — the same
   fixed-literal identity collision the package's own comments treat as a defect for session ids — so
   a suite exercising RUNTIME-003 two-submission semantics through the SSOT double cannot represent
   two distinct submissions.

## Evidence (adversarially verified 2026-08-13, PARTIAL — (2) and the surface facts confirmed; (1) reframed)

- `packages/agent-interface-session/src/session-contracts.ts:372` — `getSession(): { getSessionId():
string }`. `packages/agent-framework/src/interactive/interactive-session-prompt.ts:72` calls
  `ctx.getSession().getEventService()`. **Reframe (verifier correction):** that call is legally typed
  WITHIN agent-framework because `IPromptTurnContext.getSession` is declared `() => Session`
  (`interactive-session-prompt.ts:38`) and the full `Session` class publicly declares
  `getEventService()` (`agent-session/src/session.ts:198`). The defect is not a type breach at that
  line — it is that the TRANSPORT contract's `{ getSessionId(): string }` understates the session
  surface the runtime uses, which is why the conformant double must ship an off-contract stub
  (`testing/index.ts:126`, with its own SELFHOST-004 span-collector comment). At least 7 other
  packages' doubles stub the same member. No production consumer of the transport-typed
  `getSession()` is shown to call `getEventService`, so the stub is defensive, not a demonstrated
  contract-level caller.
- `packages/agent-interface-transport/src/testing/index.ts:97-99` — `submit: () => Promise.resolve({
turnId: 'test-turn', … })` — every submission of every double shares one identity, contrasting the
  package's own rationale for per-double session ids (`:117-124`, `test-double-id-coherence.test.ts`).

## Revised Direction

1. Mint a deterministic per-call `turnId` from the double's session id and a submission counter.
2. Add a red-first two-submit regression proving distinct ids and separately settled handles.
3. Keep `getSession(): { getSessionId(): string }`; remove the unowned `getEventService` extra stub.
4. Correct stale package SPEC claims about which package exports the testing double.

The exact default contract is per factory and per call: `${sessionId}-turn-1`, then
`${sessionId}-turn-2`; another double restarts at 1 under its own session id. A non-empty overridden
session id controls the prefix, a throwing/empty override uses the existing deterministic fallback,
and an overridden `submit` stays authoritative. This is a PATCH behavior correction to the published
testing subpath, not a production signature change.

## Historical Direction (partially invalid)

1. Decide the `getSession()` surface honestly: either widen the contract's return type to include the
   event-service member (or an explicit narrow port), or stop framework internals from reaching
   through the contract-typed member; then delete the off-contract `getEventService` stub from the
   double. (Distinct from ARCH-012's too-wide/optionality axis — this is the declared surface being
   too NARROW.)
2. Mint a per-call `turnId` in the default `submit` (counter-suffixed, same reproducibility argument
   as the per-double session id), so RUNTIME-003 two-submission behavior is testable through the SSOT
   double.

## Revised Test Plan

- Red-first: submit twice through one `createTestInteractiveSession` and assert different,
  deterministic ids plus successful completion for each handle.
- Type/regression: the default nested session exposes only `getSessionId`; affected consumers compile.
- Public SDK scenario: import the published `./testing` subpath, submit twice, print ids and
  `DISTINCT`, exit 0, and clean up scratch files.
- Package build/typecheck/tests, scoped harness verification, and CI-equivalent verification green.

## Plan

- [x] TC-01: add red-first exact per-call/per-double turn identity and settlement regressions.
- [x] TC-02: remove the undeclared nested event-service stub and prove the identity-only shape.
- [x] TC-03: cover session-id override, throwing/empty fallback, and authoritative submit override.
- [x] TC-04: synchronize both owner SPECs and add the PATCH changeset.
- [x] TC-05: author, gate, execute, and record the durable public testing-subpath scenario.
- [x] TC-06: run affected package and broad harness verification; completion gates and atomic archive
      follow only after this plan is complete.

## Blockers

- None.

## Progress

### 2026-08-14

- Added deterministic per-factory submission identities and removed the undeclared nested event-service
  fixture member under red-first regression coverage.
- Synchronized the two owner SPECs and recorded a PATCH changeset for the published testing subpath.
- Executed the public SDK scenario successfully with exact identity and cleanup markers.
- Verified the affected packages and completed `pnpm harness:verify-like-ci` with 12/12 stages passing
  in 6m 0.8s.

## Result

The sanctioned public testing double now mints deterministic, distinct submission identities per
factory, preserves every override/fallback path, and exposes only its declared nested identity surface.
Both owner SPECs and the PATCH changeset agree on the sole testing-subpath owner. The durable public
SDK scenario, affected-package checks, scoped harness verification, scans, and the 12-stage CI mirror
all passed; DONE-GATE-STAGE-2 and GATE-COMPLETE independently passed before archival.

## Historical Test Plan

- Red-first: a test submitting twice through `createTestInteractiveSession` asserts two distinct
  `turnId`s (fails today — both `'test-turn'`).
- After (1): a strictly-typed consumer implementing only `getSession(): { getSessionId() }` compiles
  and the span-collector path still works (or the contract is documented to include the wider member);
  the double no longer needs an off-contract stub.
- `pnpm harness:verify -- --scope packages/agent-interface-transport` green.

## User Execution Test Scenarios

**Applies — via the public SDK surface** (a consumer using
`@robota-sdk/agent-interface-transport/testing`). Exact agent-executable commands, prerequisites,
observable output, bounds, cleanup, and the evidence field live in
[`arch-019-test-session-turn-identity-agent-run.md`](../../evals/scenarios/arch-019-test-session-turn-identity-agent-run.md).

- Prerequisites: built workspace; a scratch consumer that constructs the double and submits two
  prompts.
- Steps: submit twice; read the two returned turn handles' ids.
- Expected (after fix): the two ids differ.
- Expected (before fix, contrast): both ids are `'test-turn'`.
- Cleanup: delete the scratch project.
- Evidence: the durable scenario records the two distinct turn ids, settled handles, exit 0, and
  successful cleanup from the independent Stage-2 execution.

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-08-14

**Status upgrade:** scenario drafted → scenario written
Scenario `ARCH-019 — published test session mints one identity per submission (agent-run)` is fully
written at `.agents/evals/scenarios/arch-019-test-session-turn-identity-agent-run.md`. It is explicitly
agent-executable; states complete local prerequisites and the absence of credential/network needs;
supplies an exact bounded Bash/Node command driving the built public
`@robota-sdk/agent-interface-transport/testing` export; requires exit 0 and exact deterministic
two-turn output plus settled completions; validates failure modes; provides path-bounded cleanup; and
carries an intentionally empty pre-implementation Observed evidence field for Stage 2.

### [DONE-GATE-STAGE-1] — ❌ FAIL | 2026-08-14

**Status remains:** scenario drafted
**Failed criteria:**

- Expected observable result: the revised document attributed `CLEANUP_OK` to the consumer Node
  process and called four displayed lines exact output, but the consumer prints the first three,
  Bash prints `CLEANUP_OK` after cleanup, and the build may also emit setup output.
  **Required action:** Correct output provenance and define the three consumer lines plus the Bash
  cleanup marker separately from build output.

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-08-14

**Status upgrade:** scenario drafted → scenario written
Scenario `ARCH-019 — published test session mints one identity per submission (agent-run)` is fully
written at `.agents/evals/scenarios/arch-019-test-session-turn-identity-agent-run.md`. It declares
agent executability and complete credential-free prerequisites; provides an exact bounded Bash/Node
command against the built public testing subpath; separates package-build setup output from the exact
three consumer lines and the single Bash `CLEANUP_OK` marker; asserts distinct deterministic IDs and
settled handles; uses validated explicit cleanup with an EXIT fallback and absence proof; and retains
an empty Observed evidence field for post-implementation Stage 2.

### [DONE-GATE-STAGE-2] — ✅ PASS | 2026-08-14

**Status upgrade:** scenario written → scenario verified
The agent freshly ran the sole durable scenario from repository root with `/bin/bash` against HEAD
`e519f7e3c`. The built public `@robota-sdk/agent-interface-transport/testing` consumer exited 0 and
printed exactly `test-session-1-turn-1`, `test-session-1-turn-2`, and `DISTINCT`; both completion
promises settled. Explicit cleanup succeeded, Bash printed `CLEANUP_OK`, and a post-run temp-directory
probe found no `robota-arch019.*` directory. The matching concrete evidence is recorded in
`.agents/evals/scenarios/arch-019-test-session-turn-identity-agent-run.md`; build output is setup, not
substituted user-execution evidence.
