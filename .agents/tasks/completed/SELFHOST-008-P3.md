# SELFHOST-008 P3 — per-turn durable-memory recall (task breakdown)

Spec: [`.agents/spec-docs/active/SELFHOST-008-P3-per-turn-recall.md`](../spec-docs/active/SELFHOST-008-P3-per-turn-recall.md)
(GATE-APPROVAL ENDORSE + owner "승인"). Three-package change, deps one-way
(`agent-framework → agent-session → agent-core`). Commit per logical slice as it goes green.

## Design (from the approved spec)

- **agent-core** owns the ephemeral primitive: `IRunOptions.ephemeralSystemContext?: string`, threaded
  `buildRunContext` → `IExecutionContext` → `ExecutionService.execute`, emitted as a transient system-role message in
  the provider request (derived provider-message array at the round seam) with **no `addUserMessage`/`addMessage`** —
  reaches the model for that call only, never persisted to the conversation store, no static-section rebuild.
- **agent-session** `run(message, rawInput?, options?: { ephemeralSystemContext?: string })` — thin pass-through into
  `IRunOptions.ephemeralSystemContext`.
- **agent-framework** interactive execution controller computes per-turn recall (query = the turn `input`) via
  `getMemoryStore().recall(input, budget)` → render (distinct `<recalled-memory>` label) → pass as
  `ephemeralSystemContext`; gated on a surface-supplied `recallMemory?` policy (enable + `IMemoryBudget`); try/catch →
  skip on error (never breaks the turn). v1 does NOT dedup against the startup index (granularity mismatch — deferred).

## Slices (each green + committed before the next)

1. **S1 — agent-core ephemeral seam.** Add `ephemeralSystemContext?` to `IRunOptions`; thread through
   `buildRunContext` → `IExecutionContext` → `ExecutionService.execute`; emit as a transient provider-request system
   message with no store write. Test TC-03 (reaches provider, absent from conversation store). (agent-core)
2. **S2 — agent-session pass-through.** `run(message, rawInput?, options?)` forwards `ephemeralSystemContext` into the
   `robota.run` `IRunOptions`. (agent-session)
3. **S3 — recall render label.** Add a distinct `<recalled-memory>` render (param on `renderRetrievedMemory` or a
   sibling helper) so per-turn recall is distinguishable from the static startup `<project-memory>`. (agent-framework)
4. **S4 — controller wiring + options.** Thread `recallMemory?` policy through `IInteractiveSessionStandardOptions`;
   compute recall at turn start in the execution controller, pass through the prompt path to `session.run`; adapter-gated;
   try/catch → skip. Tests TC-01, TC-04, TC-05, TC-06. (agent-framework)
5. **S5 — ephemeral end-to-end.** TC-02 (recalled block absent from BOTH the interactive history and the conversation
   store after a turn; present in the model call). (agent-framework functional)
6. **S6 — neutrality + docs.** TC-07 (`pnpm harness:scan` memory-neutrality green; no content/prompt in `packages/`);
   update `agent-core`/`agent-session`/`agent-framework` `docs/SPEC.md`.

## Test Plan

- **agent-core** unit: TC-03 ephemeral seam — `run({ ephemeralSystemContext })` reaches the provider request as a
  system message AND `getHistory()`/conversation store contains no such message after the run; a run without it is
  unchanged.
- **agent-framework** unit/functional (`interactive-session-recall.test.ts`): TC-01 recall fires per turn (fake
  session/store); TC-02 ephemeral (absent from both histories; fails if prepended to `modelInput`); TC-04 adapter-gating
  (no `recallMemory` ⇒ no recall); TC-05 guarded (throwing recall does not fail the turn); TC-06 budget respected
  (recall called with the supplied `IMemoryBudget`; char cap honored).
- **Neutrality**: TC-07 `pnpm harness:scan` (memory-neutrality + dependency-direction) green + file-set review.
- **Regression**: `pnpm --filter @robota-sdk/agent-core --filter @robota-sdk/agent-session --filter
@robota-sdk/agent-framework test`, `pnpm typecheck`, `pnpm lint`, `pnpm harness:scan`.
