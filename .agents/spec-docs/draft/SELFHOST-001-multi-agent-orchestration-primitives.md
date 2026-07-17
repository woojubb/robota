---
status: draft
type: BEHAVIOR
tags: [orchestration, multi-agent, agent-core, agent-framework, selfhost]
---

# SELFHOST-001 (EPIC): first-class multi-agent orchestration primitives

## Problem

Promotes backlog [SELFHOST-001](../../backlog/SELFHOST-001-multi-agent-orchestration-primitives.md) toward the
[VISION.md](../../../VISION.md) self-hosting goal. Robota can spawn subagents through `agent-executor`'s
`ISubagentRunner` port (realized in-process by `agent-framework`'s `createInProcessSubagentRunner`, and by a
child-process runner in `agent-subagent-runner` injected at the `agent-cli` root), but there are **no first-class
named orchestration patterns** — the single most-commonly-touted advantage across the agent landscape and Robota's
biggest capability gap. Concretely: to have Robota develop Robota, the agent must compose a planner delegating to
workers, run reviewers in parallel, or hand a conversation to a specialist, using named neutral primitives — today
each such structure is hand-wired per call site.

## Prior Art Research

From product documentation: CrewAI Processes — sequential / hierarchical + manager delegation
(https://docs.crewai.com/); OpenAI Agents SDK **handoffs** transfer loop ownership between agents
(https://openai.github.io/openai-agents-python/); Google ADK workflow agents — Sequential / Parallel / Loop vs
LLM-driven transfer (https://google.github.io/adk-docs/agents/workflow-agents/); Microsoft Agent Framework —
sequential / concurrent / **handoff** / group-chat / Magentic-One (https://learn.microsoft.com/en-us/agent-framework/overview/).
Common shape: a small set of **named orchestration primitives** (sequential, parallel/concurrent,
hierarchical/manager-delegation, handoff/control-transfer, group-chat) + explicit control transfer. Note the prior
art keeps **manager-delegation** (hierarchical) and **control-transfer** (handoff) as two DISTINCT primitives.
Constraint: all are neutral mechanisms (no persona/room/topic) — library-neutral.

## Architecture Review

### Affected Scope

- **`agent-core`**: neutral orchestration **contracts** (pure interfaces) + the **event-type unions** the
  primitives emit, over the existing `event-service`. Zero new `@robota-sdk/agent-*` production deps. Requires a
  Boundaries amendment (below).
- **`agent-framework`**: the primitive **mechanism/assembly** (concurrency, delegation, turn-taking), composing
  over `agent-executor`'s **`ISubagentRunner` / `SubagentManager` port** — which framework already implements via
  `createInProcessSubagentRunner` (`agent-framework/src/subagents/in-process-subagent-runner.ts`).
- **`agent-cli`** (composition root): keeps injecting the concrete child-process runner (`agent-subagent-runner`).
  Framework MUST NOT depend on `agent-subagent-runner` (it depends on `agent-framework` → would be a cycle).

### Alternatives Considered

1. **Neutral contracts+events in agent-core; mechanism/assembly in agent-framework over `agent-executor`'s
   `ISubagentRunner` port (CHOSEN).**
   - ✅ Correct layering (core owns the abstracts + event-service the consuming layer implements — mirrors
     `AbstractAIProvider`); reuses the existing subagent port; no dependency cycle; neutral.
   - ❌ Requires amending `agent-core/docs/SPEC.md` Boundaries (today `:1121` frames the multi-agent layer as a
     _consumer_ of core) to take ownership of the neutral orchestration _contracts_.
2. **Compose over `agent-subagent-runner` (the concrete child-process runner).**
   - ✅ It is the richest runner.
   - ❌ `agent-subagent-runner` depends on `agent-framework` → framework composing over it is a **dependency cycle**.
     REJECTED (one-way-deps rule). The concrete runner is injected at the `agent-cli` root instead.
3. **Model everything as DAG nodes in dag-\*.**
   - ✅ Reuses the graph engine.
   - ❌ Conflates conversational/dynamic orchestration (handoff = loop-ownership transfer, group-chat turn-taking)
     with the static workflow product. REJECTED as the primary home (a DAG adapter for sequential/parallel is a
     later, optional mapping).

### Decision

Adopt (1): neutral orchestration **contracts + event-type unions in `agent-core`** (with a SPEC Boundaries
amendment), and the **mechanism/assembly in `agent-framework`** composing over `agent-executor`'s `ISubagentRunner`
port; the concrete runner stays injected at the `agent-cli` composition root. **Why core (real rationale):** the
event-type unions **co-locate with core's existing event-payload contracts** (`IAgentEventData`/`IToolEventData`
in `event-service/interfaces.ts`) — an interface package would fragment that SSOT — and there is a **single
implementer family** today (framework). (Not "because it mirrors `AbstractAIProvider`", which is a runtime class;
these are pure contracts.) **Extraction trigger (B3):** when a second implementer family lands (a dag-\* adapter
mapping sequential/parallel to the graph), extract the **pure contracts** — not the event unions — into a new
`agent-interface-orchestration` package so dag-\* need not depend on heavy `agent-core`. The role/manager concepts
are opaque neutral mechanisms — no room/persona/topic fields (TRANS-001 neutrality).

### Validated Recommendation (spec-workflow.md)

- **Reachability:** the composition seam is `agent-executor`'s `ISubagentRunner`/`SubagentManager`, already
  implemented by `createInProcessSubagentRunner` in framework — so the assembly is reachable without a new port and
  without a cycle. Verified against `agent-subagent-runner/package.json` (deps agent-framework → cannot be the seam).
- **Capability preservation:** the five primitives compose the existing subagent-run capability; no existing
  single-agent path changes. `sequential`/`parallel` also map cleanly to a later DAG adapter (capability retained).
- **Adversarial:** the highest drift risk is `group-chat`/`hierarchical` leaking app-domain (room/persona/topic);
  the neutrality guardrail + TC-05 block it. The other risk (the cycle) is now designed out.

### Architecture Review Checklist

- [x] 영향 패키지/레이어: agent-core (contracts+event-types, +SPEC amendment), agent-framework (assembly over ISubagentRunner). agent-cli injects the concrete runner. No package/app domain content.
- [x] Sibling scan 완료 — composes over `agent-executor` `ISubagentRunner` (already realized by `createInProcessSubagentRunner`); does NOT depend on `agent-subagent-runner` (would cycle); no DAG duplication.
- [x] 대안 최소 2개 — 3 considered (core-contracts+framework-assembly-over-port CHOSEN; compose-over-subagent-runner REJECTED cycle; DAG-only REJECTED conflation), each Pro+Con.
- [x] 결정 근거 — core owns the neutral contracts (mirrors AbstractAIProvider) + no-cycle composition over the executor port; Validated-Recommendation recorded above; independent GATE-APPROVAL re-review pending.

## Solution

Five neutral primitives — **sequential**, **parallel/concurrent** (bounded concurrency + aggregation),
**hierarchical/manager-delegation**, **handoff/control-transfer** (distinct from delegation), **group-chat**
(turn-taking) — defined as pure contracts + event-type unions in agent-core; the mechanism assembled in
agent-framework over `agent-executor`'s `ISubagentRunner`. Per-subagent tool restriction reuses existing permission
scoping. No room/persona/topic anywhere.

**Epic delivery (vertical slices):**

- **P1 (this slice):** agent-core contracts + event-type unions + the **`sequential`** primitive end-to-end through
  framework assembly over `ISubagentRunner` — proves the layering at lowest risk. Includes the agent-core SPEC amendment.
- **P2:** `parallel`/`handoff` (control-transfer). **P3:** `hierarchical`/`group-chat`.

## Affected Files

| File                                                | Change                                                                    |
| --------------------------------------------------- | ------------------------------------------------------------------------- |
| `packages/agent-core/src/orchestration/` (new)      | neutral primitive contracts + event-type unions                           |
| `packages/agent-core/src/index.ts`                  | export the contracts                                                      |
| `packages/agent-core/docs/SPEC.md`                  | Boundaries amendment: agent-core owns the neutral orchestration contracts |
| `packages/agent-framework/src/orchestration/` (new) | assembly over `agent-executor` `ISubagentRunner` + builder API            |
| `packages/agent-framework/docs/SPEC.md`             | document the assembly surface                                             |

## Completion Criteria

- [ ] TC-01: agent-core exposes the primitive contracts + event-type unions with zero new `@robota-sdk/agent-*` production deps (deps scan).
- [ ] TC-02: the `sequential` primitive emits its lifecycle events on the existing event-service (unit test).
- [ ] TC-03: agent-framework composes a `sequential` run end-to-end over `agent-executor`'s `ISubagentRunner` (via `createInProcessSubagentRunner`) — functional test; framework carries NO dep on `agent-subagent-runner` (deps scan).
- [ ] TC-04: `agent-framework` does not depend on `agent-subagent-runner` (no-cycle) — verified by the deps/one-way scan.
- [ ] TC-05: no room/persona/topic (or other app-domain) fields in the orchestration contracts — enforced by a **bespoke, failing-capable structural test/scan** over the orchestration contract shapes (NOT the `interface-runtime` scan, which neither covers `agent-core` nor checks app-domain field names, so it would be false-green here).
- [ ] TC-06: agent-core + agent-framework SPEC.md document the new surface incl. the Boundaries amendment (docs scan).

## Test Plan

| TC    | Verification                       | Type/Tool                                            |
| ----- | ---------------------------------- | ---------------------------------------------------- |
| TC-01 | zero new agent-\* deps             | `pnpm harness:scan` deps                             |
| TC-02 | sequential events fire             | vitest unit                                          |
| TC-03 | sequential over ISubagentRunner    | framework functional test                            |
| TC-04 | no agent-subagent-runner dep       | deps/one-way scan                                    |
| TC-05 | neutrality (no room/persona/topic) | bespoke structural test/scan (not interface-runtime) |
| TC-06 | SPEC updated + amendment           | docs-structure scan                                  |

## Tasks

`.agents/tasks/SELFHOST-001*.md` — 미생성 (GATE-APPROVAL 통과 후 생성). Epic slices P1 (sequential + contracts +
SPEC amendment), P2 (parallel + handoff), P3 (hierarchical + group-chat).

## Evidence Log

- 2026-07-16 — **GATE-APPROVAL iteration 1: REVISE** (independent proposal-reviewer). Flagged: composition target
  `agent-subagent-runner` = dependency cycle; agent-core SPEC frames multi-agent as consumer (`:1121`); missing
  `### Decision` + Validated-Recommendation; epic not split; hierarchical vs handoff conflated; group-chat neutrality.
- 2026-07-16 — **Revisions applied (this draft):** compose over `agent-executor` `ISubagentRunner` (cycle designed
  out, verified against package deps); `### Decision` + Validated-Recommendation (reachability/capability/adversarial)
  added; agent-core SPEC Boundaries amendment scoped; epic split into P1 (`sequential` slice) / P2 / P3; hierarchical
  (delegation) vs handoff (control-transfer) disambiguated; group-chat/hierarchical neutrality guardrail (TC-05).
  Re-review pending.
- 2026-07-16 — **iteration 2: RE-REVIEW → one-fix bounce, now applied.** Re-reviewer confirmed the cycle fix +
  Decision + Validated-Recommendation + epic split RESOLVED; the one blocker (TC-05 neutrality cited the
  `interface-runtime` scan, which doesn't cover agent-core or app-domain fields → false-green) fixed: TC-05 now a
  bespoke failing-capable structural test; core-placement rationale corrected (event-union co-location + single
  implementer, not "mirrors AbstractAIProvider"); extraction trigger to `agent-interface-orchestration` at the
  dag-adapter family recorded. Iteration-3 re-review pending.
