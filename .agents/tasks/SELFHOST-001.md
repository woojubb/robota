<!-- archival-exempt: EPIC in progress — all 5 primitives implemented (P1 sequential, P2 parallel/handoff, P3 hierarchical/group-chat); the spec stays in spec-docs/active/ until GATE-VERIFY/GATE-COMPLETE run and move it to done/. -->

# SELFHOST-001 — first-class multi-agent orchestration primitives (EPIC)

Spec: [`.agents/spec-docs/active/SELFHOST-001-multi-agent-orchestration-primitives.md`](../spec-docs/active/SELFHOST-001-multi-agent-orchestration-primitives.md)
GATE-APPROVAL: PASSED (iteration 4 ENDORSE). GATE-IMPLEMENT: P1+P2+P3 implemented (all 5 primitives); GATE-VERIFY/GATE-COMPLETE next.

## P1 — `sequential` + neutral contracts + SPEC amendment (this slice) ✅ IMPLEMENTED

- [x] agent-core: neutral orchestration contracts + event-type unions in `packages/agent-core/src/orchestration/`
      (`orchestration-contracts.ts`, `orchestration-events.ts`, `index.ts`), exported from `src/index.ts`.
      Pure types + const event names — zero new `@robota-sdk/agent-*` production deps (**TC-01** — deps scan green).
- [x] agent-framework: the `sequential` mechanism in `packages/agent-framework/src/orchestration/sequential.ts`,
      composing over `agent-executor`'s `ISubagentManager`/`ISubagentRunner` port; emits neutral lifecycle events
      over the event-service (**TC-02**), runs end-to-end over the port (**TC-03**). Exported from `src/index.ts`.
- [x] framework carries NO dep on `agent-subagent-runner` (**TC-04** — deps/one-way scan green; no-cycle).
- [x] `orchestration-neutrality` standing scan (`scripts/harness/scan-orchestration-neutrality.mjs`), registered in
      `run-all-scans.mjs`, failing-capable, guards P2/P3 `hierarchical`/`group-chat` (**TC-05**).
- [x] SPEC amendments (**TC-06**): `agent-core/docs/SPEC.md` Boundaries reclassifies core as OWNER of the neutral
      orchestration contracts + event unions (framework IMPLEMENTS them) + a dedicated Orchestration Public API
      subsection; `agent-framework/docs/SPEC.md` documents `runSequential`.
- [x] Tests: `packages/agent-framework/src/orchestration/__tests__/sequential.test.ts` (5 tests: events, output
      threading, threadOutput:false, failed-rethrow, end-to-end over a SubagentManager backed by an ISubagentRunner).
- [x] Verified locally: build (core+framework), typecheck, tests (5/5), lint (0 errors), `pnpm harness:scan`
      (all 54 scans pass incl. `orchestration-neutrality`, `deps`, `spec-public-surface`).

## Test Plan (P1)

Maps the spec's Completion Criteria to the shipped verification (all green locally):

- **TC-01** (agent-core contracts + event unions, zero new `@robota-sdk/agent-*` deps) — `deps` dependency-direction scan.
- **TC-02** (`sequential` emits lifecycle events over the event-service) — `sequential.test.ts` "emits the neutral lifecycle events".
- **TC-03** (framework composes `sequential` end-to-end over `ISubagentRunner`) — `sequential.test.ts` "composes end-to-end over a SubagentManager backed by an ISubagentRunner".
- **TC-04** (no `agent-subagent-runner` dep / no-cycle) — `deps`/one-way scan.
- **TC-05** (neutrality — no app-domain identity in the contracts) — standing `orchestration-neutrality` `pnpm harness:scan` floor (failing-capable; verified it FAILs on an injected `room` field and passes clean).
- **TC-06** (SPEC amendments documented) — `spec-public-surface` + `docs-structure` scans; agent-core/agent-framework SPEC.md updated.

Command evidence: `pnpm --filter @robota-sdk/agent-core --filter @robota-sdk/agent-framework build && … typecheck` (pass), `… test src/orchestration/__tests__/sequential.test.ts` (5/5), `… lint` (0 errors), `pnpm harness:scan` (all 54 scans pass).

## P2 — `parallel` (bounded concurrency + aggregation) + `handoff` (control-transfer) ✅ IMPLEMENTED

- [x] agent-core: `IParallelOrchestrationSpec` (concurrent steps + bounded `maxConcurrency`) and
      `IHandoffOrchestrationSpec` (control-transfer among steps; `entryStepId` + `maxHandoffs` loop bound) added to
      `orchestration-contracts.ts`; `IOrchestrationRunResult.output` doc generalized (sequential/handoff = last
      step; parallel = order-preserving join). Exported from `src/orchestration/index.ts` + `src/index.ts`. Pure
      types — still zero new `@robota-sdk/agent-*` production deps.
- [x] agent-framework: `runParallel` (`parallel.ts`) — bounded-concurrency worker pool, order-preserving results,
      `\n\n`-joined aggregate; `runHandoff` (`handoff.ts`) — dynamic control-transfer driven by an injected neutral
      `resolveHandoff` policy (WHICH step receives control is a caller decision, so the primitive stays neutral),
      previous-output threading, `maxHandoffs` loop-bound guard. Both compose over the same
      `agent-executor` `ISubagentManager`/`ISubagentRunner` port; spawn/wait/event mechanics factored into
      `shared.ts` (also now used by the refactored `sequential.ts`). Exported from both index files.
- [x] Still NO dep on `agent-subagent-runner` (no-cycle — `deps` scan green); neutrality floor
      (`orchestration-neutrality`) already covers the new source and stays clean.
- [x] SPEC amendments: `agent-core/docs/SPEC.md` Orchestration Public API table adds the two specs;
      `agent-framework/docs/SPEC.md` documents `runParallel`/`runHandoff` + the `shared.ts` factoring.
- [x] Tests: `parallel.test.ts` (7: order+aggregate, bounded-concurrency peak, unbounded, `maxConcurrency<=0`,
      events, failed-rethrow, end-to-end over a real `SubagentManager`), `handoff.test.ts` (5: transfer+thread+order,
      stop-on-null, maxHandoffs-exceeded, unknown-target, end-to-end), shared `orchestration-test-helpers.ts`.
      Review-polish (PR #1194, 0 actionable): `runParallel` fail-fast (siblings stop pulling steps once one throws) + `IOrchestrationRunResult.steps` ordering doc made primitive-precise.
- [x] Verified locally: build (core+framework), typecheck, orchestration tests **18/18** (6 sequential + 7 parallel + 5 handoff),
      lint (0 errors), `pnpm harness:scan` (all **54** scans pass), `harness:test` neutrality scan 5/5.

## P3 — `hierarchical` (manager-delegation) + `group-chat` (turn-taking) ✅ IMPLEMENTED

- [x] agent-core: `IOrchestrationDelegation` (`stepId` + `prompt`), `IHierarchicalOrchestrationSpec`
      (`managerStepId` + `maxRounds` loop bound) and `IGroupChatOrchestrationSpec` (`firstStepId` + `maxTurns` loop
      bound) added to `orchestration-contracts.ts`; `IOrchestrationRunResult` steps/output docs generalized to all
      five primitives. Exported from `src/orchestration/index.ts` + `src/index.ts`. Still zero new
      `@robota-sdk/agent-*` production deps.
- [x] agent-framework: `runHierarchical` (`hierarchical.ts`) — a manager step delegates to workers via an injected
      neutral `planDelegation` policy, worker output aggregated + threaded back into the manager's next round,
      `maxRounds` guard; `runGroupChat` (`group-chat.ts`) — steps take turns chosen by an injected neutral
      `selectNextStep` policy, prior turns threaded as id-labeled history, `maxTurns` guard. Both reuse
      `shared.ts` (spawn/wait/event mechanics) and compose over the same `ISubagentManager`/`ISubagentRunner` port.
      Exported from both index files.
- [x] **Neutrality held for the highest-drift primitives**: `hierarchical`/`group-chat` carry NO app-domain
      identity — the standing `orchestration-neutrality` floor covers the new source and stays clean (0 findings);
      WHO delegates / WHO speaks next is a caller-injected policy, not baked-in routing.
- [x] Still NO dep on `agent-subagent-runner` (no-cycle — `deps` scan green).
- [x] SPEC amendments: `agent-core/docs/SPEC.md` Orchestration Public API table adds the three P3 types;
      `agent-framework/docs/SPEC.md` documents `runHierarchical`/`runGroupChat`.
- [x] Tests: `hierarchical.test.ts` (6: delegate+thread-back+order, no-delegation, maxRounds-exceeded,
      unknown-delegation-target, manager-not-found, end-to-end), `group-chat.test.ts` (6: turn-taking+thread+order,
      end-on-null, default-first-step, maxTurns-exceeded, unknown-first-step, end-to-end).
- [x] Verified locally: build (core+framework), typecheck, orchestration tests **30/30** (6 sequential + 7 parallel + 5 handoff + 6 hierarchical + 6 group-chat), lint (0 errors), `pnpm harness:scan` (all **54** scans pass),
      `harness:test` neutrality scan 5/5.

**Epic status:** all FIVE named orchestration primitives (sequential, parallel, handoff, hierarchical, group-chat)
are now implemented. Remaining: GATE-VERIFY + GATE-COMPLETE (move the epic spec `active/` → `done/` with
done-evidence) — a dedicated verification pass, tracked as the immediate next step.

## Extraction trigger (B3, deferred)

When a second implementer family lands (a dag-\* adapter mapping sequential/parallel onto the graph engine), move
BOTH the pure contracts AND the event-type unions into a new `agent-interface-orchestration` package
(deps ⊆ {agent-core}), mirroring `agent-interface-transport`.
