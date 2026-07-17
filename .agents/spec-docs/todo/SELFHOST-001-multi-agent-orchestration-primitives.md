---
status: approved
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
   - ✅ Correct layering (core owns the neutral abstracts + event unions the consuming framework layer implements —
     justified by single-implementer-family + YAGNI + the pinned B3 extraction trigger, NOT by a runtime-class
     analogy); reuses the existing subagent port; no dependency cycle; neutral.
   - ❌ Requires amending `agent-core/docs/SPEC.md` Boundaries: today `:1121` frames the multi-agent/orchestration
     layer as a _consumer_ of core ("the multi-agent/orchestration layer consumes `Robota`, `IAgentConfig`, event
     services"). It must be converted to **"agent-core OWNS the neutral orchestration contracts + event-type
     unions; the framework layer IMPLEMENTS them"**, reclassifying core's role in that Boundaries / Key-Peer-
     Contracts section.
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
port; the concrete runner stays injected at the `agent-cli` composition root. **Why core (real rationale):** a
**single implementer family** today (framework) + **YAGNI** — an interface package earns its keep only once a
second consuming family exists, and there is none yet — plus a **pre-committed extraction trigger** (below) that
keeps the later split mechanical. (Not "because it mirrors `AbstractAIProvider`", which is a runtime class; these
are pure contracts. And explicitly _not_ "an interface package would fragment the event-payload SSOT" — it would
not, per the analog below.) **Interface-package analog (`InteractionEvent`):** `agent-interface-transport` already
owns a runtime-emitted event union — `InteractionEvent` in `src/interaction-contracts.ts` — that **extends
`agent-core`'s base types** (`IActionRequest`/`TActionResponse`) without fragmenting any SSOT, under the allowed
Interface-Package dependency rule (deps ⊆ {`agent-core`}; see `agent-interface-transport/package.json`). So an
interface package _can_ own an event union cleanly — the fragmentation objection is false. The reason orchestration
keeps its contracts in core **now** is not fragmentation but **consumer count**: transport was extracted with **≥2
consuming families** at extraction time, whereas orchestration has **one** (agent-framework) today. **Extraction
trigger (B3):** when a second implementer family lands (a dag-\* adapter mapping sequential/parallel to the graph),
move **both** the pure contracts **and** the event-type unions into a new `agent-interface-orchestration` package
(deps ⊆ {`agent-core`}, mirroring `agent-interface-transport`), so the future dag-\* adapter depends on that light
interface package — **not** on heavy `agent-core` merely for the event types. The event unions do **not** stay in
core permanently; pinning their destination now makes the later move mechanical rather than a re-fragmentation. The
role/manager concepts are opaque neutral mechanisms — no room/persona/topic fields (TRANS-001 neutrality).

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
- [x] 결정 근거 — core owns the neutral contracts (single-family + YAGNI + pinned B3 extraction trigger, engaging the `InteractionEvent`/agent-interface-transport analog) + no-cycle composition over the executor port; Validated-Recommendation recorded above; GATE-APPROVAL PASSED (iteration 4 ENDORSE).

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

| File                                                | Change                                                                                                                                                                                                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/agent-core/src/orchestration/` (new)      | neutral primitive contracts + event-type unions                                                                                                                                                                                                   |
| `packages/agent-core/src/index.ts`                  | export the contracts                                                                                                                                                                                                                              |
| `packages/agent-core/docs/SPEC.md`                  | Boundaries amendment: convert `:1121` ("multi-agent/orchestration layer CONSUMES core") to "agent-core OWNS the neutral orchestration contracts + event-type unions; the framework layer IMPLEMENTS them"; reclassify core's role in that section |
| `packages/agent-framework/src/orchestration/` (new) | assembly over `agent-executor` `ISubagentRunner` + builder API                                                                                                                                                                                    |
| `packages/agent-framework/docs/SPEC.md`             | document the assembly surface                                                                                                                                                                                                                     |

## Completion Criteria

- [ ] TC-01: agent-core exposes the primitive contracts + event-type unions with zero new `@robota-sdk/agent-*` production deps (deps scan).
- [ ] TC-02: the `sequential` primitive emits its lifecycle events on the existing event-service (unit test).
- [ ] TC-03: agent-framework composes a `sequential` run end-to-end over `agent-executor`'s `ISubagentRunner` (via `createInProcessSubagentRunner`) — functional test; framework carries NO dep on `agent-subagent-runner` (deps scan).
- [ ] TC-04: `agent-framework` does not depend on `agent-subagent-runner` (no-cycle) — verified by the deps/one-way scan.
- [ ] TC-05: no room/persona/topic (or other app-domain) fields in the orchestration contracts — enforced by a **bespoke, failing-capable neutrality scan wired into `pnpm harness:scan` as a standing FAIL condition** (a new `orchestration-neutrality` scan registered in `scripts/harness/run-all-scans.mjs`), so it **keeps firing on every run** and guards P2/P3's `hierarchical`/`group-chat` additions when they land — not a one-time P1 vitest. Per [enforcement-architecture.md](../../rules/enforcement-architecture.md), every guardian needs a mechanical floor that keeps firing. (NOT the `interface-runtime` scan, which neither covers `agent-core` nor checks app-domain field names, so it would be false-green here.)
- [ ] TC-06: agent-core + agent-framework SPEC.md document the new surface incl. the Boundaries amendment (docs scan).

## Test Plan

| TC    | Verification                       | Type/Tool                                                                              |
| ----- | ---------------------------------- | -------------------------------------------------------------------------------------- |
| TC-01 | zero new agent-\* deps             | `pnpm harness:scan` deps                                                               |
| TC-02 | sequential events fire             | vitest unit                                                                            |
| TC-03 | sequential over ISubagentRunner    | framework functional test                                                              |
| TC-04 | no agent-subagent-runner dep       | deps/one-way scan                                                                      |
| TC-05 | neutrality (no room/persona/topic) | standing `pnpm harness:scan` floor (`orchestration-neutrality`; not interface-runtime) |
| TC-06 | SPEC updated + amendment           | docs-structure scan                                                                    |

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
- 2026-07-17 — **iteration 3: RE-REVIEW → REVISE, applied.** Independent re-reviewer's GATE-APPROVAL punch-list
  (4 fixes) applied; chosen alternative (1) unchanged. (1) **Core-placement rationale re-based** on single
  implementer family today + YAGNI + a pre-committed extraction trigger — dropped the "interface package would
  fragment the event-payload SSOT" claim, which is contradicted by `InteractionEvent` (a runtime-emitted event
  union in `agent-interface-transport/src/interaction-contracts.ts` that extends agent-core base types without
  fragmenting anything; Interface-Package deps ⊆ {agent-core}); orchestration defers the interface package now
  because it has **one** consuming family (agent-framework) vs transport's **≥2** at extraction. (2) **Extraction
  trigger tightened:** at the dag-\* second family, **both** the pure contracts **and** the event-type unions move
  to a new `agent-interface-orchestration` (deps ⊆ {agent-core}) — event unions do not stay in core permanently,
  so dag-\* need not depend on heavy agent-core just for event types. (3) **TC-05 promoted** from one-time vitest
  to a **standing `pnpm harness:scan` floor** (`orchestration-neutrality`) that keeps firing and guards P2/P3
  hierarchical/group-chat (per enforcement-architecture.md). (4) **SPEC-amendment framing pinned:** convert `:1121`
  from "multi-agent/orchestration layer CONSUMES core" to "agent-core OWNS the neutral contracts + event unions;
  framework IMPLEMENTS them", reclassifying core's Boundaries role.
- 2026-07-17 — **iteration 4: RE-REVIEW → ENDORSE** (independent proposal-reviewer). All 4 punch-list items verified
  resolved against the code (ISubagentRunner port + no-cycle composition; agent-core zero workspace deps; the
  `InteractionEvent` analog; the false-green interface-runtime scan; the SPEC amendment target). Highest-stakes call
  (new-surface placement) correct on principle with a pinned, mechanical extraction trigger. Also cleaned the two
  stale "mirrors AbstractAIProvider" phrasings the reviewer flagged as document hygiene. **GATE-APPROVAL PASSED.**
