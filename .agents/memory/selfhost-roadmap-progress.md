# SELFHOST roadmap — design-gate + implementation progress

Owner goal: **Robota builds Robota** (see [`../../VISION.md`](../../VISION.md)). The 14-spec self-hosting capability
roadmap (`.agents/backlog/SELFHOST-000..014`, derived from commercial-agent prior-art research) is the vehicle.

## Status (as of 2026-07-17)

**All 14 SELFHOST specs are DESIGN-GATED** (GATE-APPROVAL ENDORSE via independent `proposal-reviewer` iterations,
each punch-list verified against the actual code) and promoted to `.agents/spec-docs/todo/` (`status: approved`):

- Table-stakes 001–006 (PR #1190, merged): 001 orchestration primitives, 002 plan-mode, 003 codebase-index/RAG,
  004 trace/cost view, 005 guardrails, 006 per-role model routing.
- Differentiators 007–014 (PR #1191, merged): 007 branching time-travel, 008 durable/semantic memory,
  009 hook catalog, 010 computer-use, 011 evals-as-code, 012 scheduled-tasks, 013 multi-surface deployment,
  014 shared async artifacts.

**SELFHOST-001 is in GATE-IMPLEMENT** (spec now in `.agents/spec-docs/active/`, `status: in-progress`; tasks:
[`../tasks/SELFHOST-001.md`](../tasks/SELFHOST-001.md)):

- **P1 SHIPPED** (PR #1192, merged to develop, merge-verified): neutral orchestration contracts + event-type
  unions in `packages/agent-core/src/orchestration/` (agent-core OWNS them, zero new `@robota-sdk/agent-*` deps);
  the `sequential` primitive (`runSequential`) in `packages/agent-framework/src/orchestration/sequential.ts`
  composing over `agent-executor`'s `ISubagentManager`/`ISubagentRunner` port (never depends on
  `agent-subagent-runner` — the concrete runner is injected at the `agent-cli` root); a standing
  `orchestration-neutrality` harness scan (`scripts/harness/scan-orchestration-neutrality.mjs`, identifier-CONTAINING
  match so camelCase `roomId`/`personaName` are caught) + its red-fixture test; agent-core/agent-framework SPEC
  amendments (core reclassified as OWNER of the neutral contracts).
- **P2 SHIPPED** (PR #1194, merged to develop `354e55e99`, merge-verified): `runParallel` (bounded-concurrency
  worker pool + fail-fast + order-preserving `\n\n`-join aggregate) + `runHandoff` (dynamic loop-ownership transfer
  via an INJECTED neutral `resolveHandoff` policy; previous-output threading; `maxHandoffs` guard). Contracts
  `IParallelOrchestrationSpec` + `IHandoffOrchestrationSpec`. spawn/wait/event mechanics factored into
  `orchestration/shared.ts` (sequential refactored onto it; `ISequentialRunContext` kept as alias).
- **P3 IMPLEMENTED** (this PR): `runHierarchical` (manager step delegates to workers via an injected neutral
  `planDelegation` policy; worker output threaded back each round; `maxRounds` guard) + `runGroupChat` (steps take
  turns chosen by an injected neutral `selectNextStep` policy; prior turns threaded as id-labeled history; `maxTurns`
  guard). Contracts `IOrchestrationDelegation` + `IHierarchicalOrchestrationSpec` + `IGroupChatOrchestrationSpec`.
  Neutrality held for these two highest-drift primitives — WHO delegates / WHO speaks next is caller-injected, and
  the standing `orchestration-neutrality` floor stays clean. **All five named primitives now implemented** (30 tests).
- **GATE-VERIFY + GATE-COMPLETE PASSED** — spec moved `active/` → `.agents/spec-docs/done/`, `status: done`,
  `completed: 2026-07-17`; task archived to `.agents/tasks/completed/SELFHOST-001.md`. All 6 Completion Criteria
  `[x]` with per-TC evidence; User-Execution done-gate passed via a public-SDK-usage scenario (UET-01, exit 0,
  all 5 primitives run — script in `scratch/src/`, INFRA-023). **SELFHOST-001 is DONE.**
- **B3 extraction trigger** (deferred): when a second implementer family lands (a dag-\* adapter), move BOTH the
  contracts AND event unions into a new `agent-interface-orchestration` package (deps ⊆ {agent-core}).

## How this was executed (reusable pattern)

Design-gate ALL specs first (owner's chosen path "설계-게이트 일괄"), then implement in priority order. Each spec
authored grounded in real code (four corrected inaccurate backlog seeds against the codebase); the independent
`proposal-reviewer` gate repeatedly caught genuine code-verified defects (dependency cycles, wrong placement,
unbuildable data-flow, a neutrality scan bypassable by camelCase) BEFORE any code — see the specs' Evidence Logs.
PRs use the DX-001 batching policy (one coherent design-gate pass per PR) and the HARNESS-018 async PR-review
(reviewer → 0/1 actionable → fix → merge). **SELFHOST-001 is DONE** (all 5 primitives, all gates). Next: pick up
the remaining 13 specs from `todo/` in priority order (they are `priority: medium`/`low`, `urgency: later`);
each follows the same GATE-IMPLEMENT → VERIFY → COMPLETE flow. Consider SELFHOST-002 (plan-mode) next.

Related: [[self-improving-harness-northstar]], [[harness-mechanical-not-skilltree]].
