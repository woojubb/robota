---
status: draft
type: BEHAVIOR
tags: [orchestration, multi-agent, agent-core, agent-framework, selfhost]
---

# SELFHOST-001: first-class multi-agent orchestration primitives

## Problem

Promotes backlog [SELFHOST-001](../../backlog/SELFHOST-001-multi-agent-orchestration-primitives.md) toward the
[VISION.md](../../../VISION.md) self-hosting goal. Robota has subagents (`agent-subagent-runner`, `agent-executor`
`subagents`), but **no first-class named orchestration patterns** — the single most-commonly-touted advantage
across the agent landscape and Robota's biggest capability gap. To develop Robota with Robota, the agent must be
able to compose named multi-agent structures (a planner delegating to workers, parallel reviewers, a handoff to a
specialist), not just spawn one-off subagents.

## Prior Art Research

From product documentation: CrewAI Processes — sequential / hierarchical + manager delegation
(https://docs.crewai.com/); OpenAI Agents SDK **handoffs** transfer loop ownership between agents
(https://openai.github.io/openai-agents-python/); Google ADK workflow agents — Sequential / Parallel / Loop vs
LLM-driven transfer (https://google.github.io/adk-docs/agents/workflow-agents/); Microsoft Agent Framework —
sequential / concurrent / handoff / group-chat / Magentic-One patterns
(https://learn.microsoft.com/en-us/agent-framework/overview/). Common shape: a small set of **named orchestration
primitives** (sequential, parallel/concurrent, hierarchical/manager, handoff, group-chat) + explicit control
transfer. Robota constraint: `agent-core` owns the "canonical orchestration surface" with zero dependency on other
`agent-*` packages, so contracts belong there; composition over the existing subagent/executor primitives belongs
in `agent-framework`. No comparable primitive is domain-specific — all are neutral mechanisms (fits library-neutrality).

## Architecture Review

### Affected Scope

- **`agent-core`**: new neutral orchestration **contracts** (abstracts/interfaces) for the primitives + the
  lifecycle events they emit (reuse the existing event-service + hooks). Zero new agent-\* deps.
- **`agent-framework`**: **assembly** that composes the primitives over the existing subagent runner / executor.
- No `packages/` domain content; no surface change required for the mechanism (a `/` command is a follow-on).

### Alternatives Considered

1. **Neutral primitives in agent-core + assembly in agent-framework (CHOSEN).**
   - ✅ Correct layer (agent-core owns the orchestration surface); reuses existing subagents/executor; neutral.
   - ❌ Requires careful contract design to keep the five patterns composable without leaking domain concepts.
2. **Implement patterns only in agent-framework (skip core contracts).**
   - ✅ Faster; no core change.
   - ❌ Puts the canonical orchestration surface in the wrong layer; providers/other consumers could not build on
     the contracts. REJECTED (violates the layer that agent-core's SPEC claims to own).
3. **Model everything as DAG nodes in dag-\*.**
   - ✅ Reuses the workflow engine's graph.
   - ❌ Conflates conversational multi-agent orchestration with the workflow/DAG product; heavier for a simple
     handoff. REJECTED as the primary home (a DAG mapping can be a later adapter).

### Architecture Review Checklist

- [x] 영향 패키지/레이어: agent-core (contracts+events), agent-framework (assembly). No package/app domain content.
- [x] Sibling scan 완료 — reuses `agent-subagent-runner` + `agent-executor` subagents + agent-core event-service/hooks; no skin-on-a-sibling; no DAG duplication.
- [x] 대안 최소 2개 — 3 considered (core-contracts+framework-assembly CHOSEN; framework-only REJECTED wrong-layer; DAG-only REJECTED conflation), each Pro+Con.
- [x] 결정 근거 — agent-core owns the orchestration surface (its SPEC) + neutrality; independent GATE-APPROVAL to run.

## Solution

Define five neutral primitives as agent-core contracts, each emitting lifecycle events; assemble them in
agent-framework over the existing subagent/executor:

- **sequential** — run agents in order, passing result forward.
- **parallel/concurrent** — run agents concurrently with a bounded concurrency + result aggregation.
- **hierarchical/manager** — a manager agent delegates sub-tasks to workers (over the subagent runner).
- **handoff** — explicit control transfer: one agent hands the conversation/loop to another.
- **group-chat** — multiple agents share a turn-taking conversation.

Each primitive: neutral contract in agent-core (no persona/domain), events on the existing event-service, tool/
model access via existing DIP. Assembly + a builder API in agent-framework. Per-subagent tool restriction reuses
the existing permission scoping.

## Affected Files

| File                                                                        | Change                                         |
| --------------------------------------------------------------------------- | ---------------------------------------------- |
| `packages/agent-core/src/orchestration/` (new)                              | neutral primitive contracts + events           |
| `packages/agent-core/src/index.ts`                                          | export the contracts                           |
| `packages/agent-framework/src/orchestration/` (new)                         | assembly over subagents/executor + builder API |
| `packages/agent-core/docs/SPEC.md`, `packages/agent-framework/docs/SPEC.md` | document the surface                           |

## Completion Criteria

- [ ] TC-01: agent-core exposes contracts for sequential/parallel/hierarchical/handoff/group-chat with zero new `@robota-sdk/agent-*` production deps (verified by the deps scan).
- [ ] TC-02: each primitive emits its lifecycle events on the existing event-service (unit-tested).
- [ ] TC-03: agent-framework composes a manager→worker **handoff** end-to-end over the existing subagent runner (functional test).
- [ ] TC-04: parallel primitive runs N agents concurrently under a bounded concurrency and aggregates results (unit + functional).
- [ ] TC-05: no domain/persona content in `packages/` (interface-runtime + neutrality guards pass).
- [ ] TC-06: SPEC.md of agent-core + agent-framework document the new surface (docs scan passes).

## Test Plan

| TC    | Verification                       | Type/Tool                 |
| ----- | ---------------------------------- | ------------------------- |
| TC-01 | zero new agent-\* deps             | `pnpm harness:scan` deps  |
| TC-02 | events fire per primitive          | vitest unit               |
| TC-03 | manager→worker handoff             | framework functional test |
| TC-04 | parallel concurrency + aggregation | vitest unit + functional  |
| TC-05 | neutrality/interface purity        | interface-runtime scan    |
| TC-06 | SPEC updated                       | docs-structure scan       |

## Tasks

`.agents/tasks/SELFHOST-001.md` — 미생성 (GATE-APPROVAL 통과 후 생성). May split: core contracts+events (P1),
framework assembly + handoff (P2), parallel/group-chat (P3).

## Evidence Log

- 2026-07-16 — **GATE-APPROVAL iteration 1: REVISE** (independent proposal-reviewer). Required before ENDORSE:
  (a) **dependency cycle** — `agent-subagent-runner` depends on `agent-framework`, so framework cannot compose over
  it; compose over `agent-executor`'s `ISubagentRunner` port (framework already implements it in
  `in-process-subagent-runner.ts`); the concrete child-process runner stays injected at the `agent-cli` root.
  Rewrite Problem/Sibling-scan/TC-03/Solution accordingly. (b) agent-core SPEC frames multi-agent as a CONSUMER
  (`SPEC.md:1121`) — re-derive the core-contract placement + amend agent-core SPEC Boundaries to own the neutral
  orchestration contracts. (c) add the `### Decision` subsection + a Validated-Recommendation record
  (reachability/capability/adversarial). (d) split into an epic; P1 vertical slice = contracts + events +
  `sequential`; disambiguate `hierarchical` (delegation) vs `handoff` (control transfer). (e) neutrality guardrail:
  `group-chat`/`hierarchical` carry no room/persona/topic. **Revision pending.**
