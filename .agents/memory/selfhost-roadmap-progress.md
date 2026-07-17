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
- **P2 PENDING**: `parallel` (bounded concurrency + aggregation) + `handoff` (control-transfer).
- **P3 PENDING**: `hierarchical` (manager-delegation) + `group-chat` (turn-taking).
- **B3 extraction trigger** (deferred): when a second implementer family lands (a dag-\* adapter), move BOTH the
  contracts AND event unions into a new `agent-interface-orchestration` package (deps ⊆ {agent-core}).

## How this was executed (reusable pattern)

Design-gate ALL specs first (owner's chosen path "설계-게이트 일괄"), then implement in priority order. Each spec
authored grounded in real code (four corrected inaccurate backlog seeds against the codebase); the independent
`proposal-reviewer` gate repeatedly caught genuine code-verified defects (dependency cycles, wrong placement,
unbuildable data-flow, a neutrality scan bypassable by camelCase) BEFORE any code — see the specs' Evidence Logs.
PRs use the DX-001 batching policy (one coherent design-gate pass per PR) and the HARNESS-018 async PR-review
(reviewer → 0/1 actionable → fix → merge). Continue from P2, then the remaining specs in priority order
(001 is P1-priority; the differentiators are `priority: medium`/`low`, `urgency: later`).

Related: [[self-improving-harness-northstar]], [[harness-mechanical-not-skilltree]].
