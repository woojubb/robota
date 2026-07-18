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

**SELFHOST-002 (explicit plan-mode) is DONE** (spec in `spec-docs/done/`, task archived; all gates). Two work units:
P1 (PR #1197) added the plan/todo-artifact + approval-event contract in `agent-interface-transport` (beside
`IGoalState`) and a **pure** `PlanController` in `agent-framework/src/plan/` (mirrors `GoalController`: returns
`{action,nextMode}`, never calls `setPermissionMode`); P2 (PR #1198) wired `InteractiveSession.setPlan/approvePlan/
revertPlan` (applies the mode flip: `setPlan`→`plan`, `approve`→`acceptEdits`, `revert`→`plan`; emits `plan_event`;
persists+restores the artifact) + the `/plan` command in `agent-command` (registered in `default-command-modules`;
only the module factory is a package export → allowlisted in `check-spec-public-surface.mjs` like its siblings). **No
second mutation gate** — reuses the existing `plan` permission mode (`MODE_POLICY`: plan blocks Write/Edit/Bash,
acceptEdits auto-applies edits but keeps Bash/Shell per-call). TC-04 proven headlessly on a real `InteractiveSession`

- injected provider AND a `/plan` print-mode CLI UET (`slash-smoke.test.ts`).

**SELFHOST-003 (codebase retrieval / RAG, EPIC, `type: DATA`) v1 is DONE** (spec in `spec-docs/done/`, task archived;
all gates). v1 = P1 (retrieval port + contract + duck-typed parser port + neutral `RepoMapRetrievalAdapter`
graph-centrality ranking + `createRetrievalTool`, adapter-gated in `createDefaultTools`, PR #1200), P2 (`buildRepoMapIndex`

- serialize/deserialize persistence; adapter builds/accepts the index once, PR #1202), P3 (`updateRepoMapIndex`
  incremental re-index — re-parse only changed files, PR #1203). Neutral throughout (parser injected, corpus from
  surface, no repo paths, no heavy dep in `agent-tools`). UET = a public-SDK demo (`scratch/src/`). **P4 (embedding-vector
  backend, may revise the port) DEFERRED** → `.agents/backlog/SELFHOST-003-P4-embedding-vector-backend.md`. Also filed:
  `HARNESS-027` (mechanical agent-tools neutrality/dep floor).

## How this was executed (reusable pattern)

Design-gate ALL specs first (owner's chosen path "설계-게이트 일괄"), then implement in priority order. Each spec
authored grounded in real code (four corrected inaccurate backlog seeds against the codebase); the independent
`proposal-reviewer` gate repeatedly caught genuine code-verified defects (dependency cycles, wrong placement,
unbuildable data-flow, a neutrality scan bypassable by camelCase) BEFORE any code — see the specs' Evidence Logs.
PRs use the DX-001 batching policy (one coherent design-gate pass per PR) and the HARNESS-018 async PR-review
(reviewer → 0/1 actionable → fix → merge). **SELFHOST-001, SELFHOST-002, SELFHOST-003 (v1), and SELFHOST-004
are DONE** (all gates). **SELFHOST-004 (run tracing + per-run cost budgeting view)** landed P1–P6 (PRs #1205,
#1210, #1211; spec in `spec-docs/done/`, task in `tasks/completed/`, TC-01…08 checked): turn-granular `costUsd`
→ span-completion event (spanId+durationMs+op) → cost-by-source + span-timeline read-model → per-run budget cap
(`LimitsPlugin.maxRunCost`, exact `calculateModelCost` path) → `usage_report` `TServerMessage` carrier +
`formatUsageReport` view → **live wiring** (session-owned `ObservableEventService`, permission-wrapper
`setEventService` forward, per-turn `collectSpanEntries` draining spans onto history before the usage-summary).
Full chain live in a real interactive turn. Note: span→turn grouping is positional (spans before each
usage-summary), not `ownerPath`-based; `ISpanEntry` carries no owner field.
**SELFHOST-005/006/007 DONE** (PRs #1213/#1214/#1215): parallel guardrails + tool-output validation; per-role model
routing (`IModelRef`/`TRoleModelMap`); branching time-travel checkpoints (neutral `CheckpointTree` + non-destructive
fork restore). **SELFHOST-008 (durable memory, EPIC) — P1 DONE** (PR #1218, merged develop `f44d16b23`, review
ACTIONABLE 0): neutral `IMemoryStore` DIP port + `IMemoryBudget` + deferred duck-typed `ISemanticMemoryAdapter`
(`agent-framework/src/memory/types.ts`, mirror sandbox `ISandboxClient`); `FileSystemMemoryStore` reference adapter
composing the existing fs classes (zero behavior change); BOTH consumers (startup injection via `loadContext` on the
interactive options path — NOT `ICreateSessionOptions` which never reads memory — + post-turn `AutomaticMemoryController`)
routed through the port adapter-gated. v1 = ONE keyword/FTS backend, semantic deferred; TC-06 neutrality = manual +
follow-up **HARNESS-029** (gates P3/P4). **P2/P3/P4 PENDING.** Also this session: **HARNESS-028** no-fallback mechanical
gate DONE (merged main #1216 + develop #1217) — see `no-fallback-gate.md`. Branch-flow lesson: NEVER PR a develop-based
branch into `main` (it sweeps the whole develop→main delta; the #1216 incident, forward-fixed by #1217).

Next: SELFHOST-008 P2→P4, then 009–014 in priority order (`priority: medium`/`low`, `urgency: later`);
each follows the same GATE-IMPLEMENT → VERIFY → COMPLETE flow.
Committing at logical boundaries per the new commit-cadence rule (git-branch.md).
Multi-package specs split into named P-slice work units (own PR each); each code-changing spec's GATE-COMPLETE needs
a real user-execution scenario (product surface — CLI print-mode or public-SDK usage, agent-executable, evidence captured).

Related: [[self-improving-harness-northstar]], [[harness-mechanical-not-skilltree]].
