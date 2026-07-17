<!-- archival-exempt: EPIC in progress — P1 shipped; P2 (parallel/handoff) + P3 (hierarchical/group-chat) remain, so the spec stays in spec-docs/active/ until the remaining slices land and GATE-VERIFY/GATE-COMPLETE run. -->

# SELFHOST-001 — first-class multi-agent orchestration primitives (EPIC)

Spec: [`.agents/spec-docs/active/SELFHOST-001-multi-agent-orchestration-primitives.md`](../spec-docs/active/SELFHOST-001-multi-agent-orchestration-primitives.md)
GATE-APPROVAL: PASSED (iteration 4 ENDORSE). GATE-IMPLEMENT: P1 in progress.

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

## P2 — `parallel` (bounded concurrency + aggregation) + `handoff` (control-transfer) — PENDING

## P3 — `hierarchical` (manager-delegation) + `group-chat` (turn-taking) — PENDING

## Extraction trigger (B3, deferred)

When a second implementer family lands (a dag-\* adapter mapping sequential/parallel onto the graph engine), move
BOTH the pure contracts AND the event-type unions into a new `agent-interface-orchestration` package
(deps ⊆ {agent-core}), mirroring `agent-interface-transport`.
