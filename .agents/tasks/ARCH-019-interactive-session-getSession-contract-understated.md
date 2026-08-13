---
title: 'ARCH-019: the IInteractiveSession getSession() return contract is narrower than the surface the framework and its sanctioned test double actually use, and the double mints one fixed turnId for every submission'
status: todo
created: 2026-08-13
priority: medium
urgency: soon
area: packages/agent-interface-transport, packages/agent-framework
depends_on: []
---

# ARCH-019: the sanctioned session double is dishonest about the contract surface

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

- `packages/agent-interface-transport/src/session-contracts.ts:372` — `getSession(): { getSessionId():
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

## Direction

1. Decide the `getSession()` surface honestly: either widen the contract's return type to include the
   event-service member (or an explicit narrow port), or stop framework internals from reaching
   through the contract-typed member; then delete the off-contract `getEventService` stub from the
   double. (Distinct from ARCH-012's too-wide/optionality axis — this is the declared surface being
   too NARROW.)
2. Mint a per-call `turnId` in the default `submit` (counter-suffixed, same reproducibility argument
   as the per-double session id), so RUNTIME-003 two-submission behavior is testable through the SSOT
   double.

## Test Plan

- Red-first: a test submitting twice through `createTestInteractiveSession` asserts two distinct
  `turnId`s (fails today — both `'test-turn'`).
- After (1): a strictly-typed consumer implementing only `getSession(): { getSessionId() }` compiles
  and the span-collector path still works (or the contract is documented to include the wider member);
  the double no longer needs an off-contract stub.
- `pnpm harness:verify -- --scope packages/agent-interface-transport` green.

## User Execution Test Scenarios

**Applies — via the public SDK surface** (a consumer using `@robota-sdk/agent-interface-transport/testing`).

- Prerequisites: built workspace; a scratch consumer that constructs the double and submits two
  prompts.
- Steps: submit twice; read the two returned turn handles' ids.
- Expected (after fix): the two ids differ.
- Expected (before fix, contrast): both ids are `'test-turn'`.
- Cleanup: delete the scratch project.
- Evidence (fill in after implementation): the two distinct turn ids printed by the consumer.
