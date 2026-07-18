---
status: done
completed: 2026-07-17
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

- [x] TC-01: agent-core exposes the primitive contracts + event-type unions with zero new `@robota-sdk/agent-*` production deps (deps scan).
- [x] TC-02: the `sequential` primitive emits its lifecycle events on the existing event-service (unit test).
- [x] TC-03: agent-framework composes a `sequential` run end-to-end over `agent-executor`'s `ISubagentRunner` (via `createInProcessSubagentRunner`) — functional test; framework carries NO dep on `agent-subagent-runner` (deps scan).
- [x] TC-04: `agent-framework` does not depend on `agent-subagent-runner` (no-cycle) — verified by the deps/one-way scan.
- [x] TC-05: no room/persona/topic (or other app-domain) fields in the orchestration contracts — enforced by a **bespoke, failing-capable neutrality scan wired into `pnpm harness:scan` as a standing FAIL condition** (a new `orchestration-neutrality` scan registered in `scripts/harness/run-all-scans.mjs`), so it **keeps firing on every run** and guards P2/P3's `hierarchical`/`group-chat` additions when they land — not a one-time P1 vitest. Per [enforcement-architecture.md](../../rules/enforcement-architecture.md), every guardian needs a mechanical floor that keeps firing. (NOT the `interface-runtime` scan, which neither covers `agent-core` nor checks app-domain field names, so it would be false-green here.)
- [x] TC-06: agent-core + agent-framework SPEC.md document the new surface incl. the Boundaries amendment (docs scan).

## Test Plan

| TC    | Verification                       | Type/Tool                                                                              |
| ----- | ---------------------------------- | -------------------------------------------------------------------------------------- |
| TC-01 | zero new agent-\* deps             | `pnpm harness:scan` deps                                                               |
| TC-02 | sequential events fire             | vitest unit                                                                            |
| TC-03 | sequential over ISubagentRunner    | framework functional test                                                              |
| TC-04 | no agent-subagent-runner dep       | deps/one-way scan                                                                      |
| TC-05 | neutrality (no room/persona/topic) | standing `pnpm harness:scan` floor (`orchestration-neutrality`; not interface-runtime) |
| TC-06 | SPEC updated + amendment           | docs-structure scan                                                                    |

**Test references (delivered across P1–P3):**

- TC-02 → `packages/agent-framework/src/orchestration/__tests__/sequential.test.ts` (events order), plus
  `parallel.test.ts` / `handoff.test.ts` / `hierarchical.test.ts` / `group-chat.test.ts` (each asserts the neutral
  STARTED/STEP\_\*/COMPLETED/FAILED lifecycle for its primitive).
- TC-03 → `sequential.test.ts` "composes end-to-end over a SubagentManager backed by an ISubagentRunner", plus the
  end-to-end case in each of `parallel.test.ts` / `handoff.test.ts` / `hierarchical.test.ts` / `group-chat.test.ts`.
- TC-01 / TC-04 → `deps` dependency-direction scan (`scripts/harness/check-dependency-direction.mjs`).
- TC-05 → `scripts/harness/scan-orchestration-neutrality.mjs` + `scripts/harness/__tests__/scan-orchestration-neutrality.test.mjs`.
- TC-06 → `docs-structure` + `spec-public-surface` scans over `packages/agent-core/docs/SPEC.md` /
  `packages/agent-framework/docs/SPEC.md`.

## User Execution Test Scenarios

**Scenario UET-01 — the five primitives run through the public SDK surface.** `agent-executable`.

- **Prerequisite state:** `pnpm --filter @robota-sdk/agent-core --filter @robota-sdk/agent-framework build`.
- **Surface:** public SDK usage — a script that imports `runSequential`/`runParallel`/`runHandoff`/
  `runHierarchical`/`runGroupChat` from `@robota-sdk/agent-framework` and runs each over a trivial in-script
  `ISubagentManager` (the subagent execution is stubbed; the primitives' owned behavior — composition, threading,
  aggregation, control-transfer, delegation, turn-taking, lifecycle events — is what is exercised). Script:
  `scratch/src/selfhost-001-orchestration-demo.ts` (INFRA-023 disposable live-verification home; `scratch/src/` is
  gitignored).
- **Exact command:** `cd scratch && pnpm run run -- src/selfhost-001-orchestration-demo.ts`
- **Expected observable result:** exit 0, and each primitive prints its neutral composition outcome —
  sequential threads (`s1→s2 | output = BUILT-from-PLAN`), parallel order-preserving join
  (`aggregate = "out:A\n\nout:B\n\nout:C"`), handoff control-transfer (`triage→specialist | output = RESOLVED`),
  hierarchical delegate-then-return (`mgr→w1→w2→mgr | output = MGR`), group-chat turn-taking
  (`a→b→a | output = A`, `events = started:1 step_completed:3 completed:1`), ending with `ALL FIVE PRIMITIVES RAN OK`.
- **Evidence:** executed 2026-07-17 via `tsx --conditions=source`, **exit 0**. Observed output:
  ```
  [sequential] order = s1→s2 | output = BUILT-from-PLAN
  [parallel] steps = a,b,c | aggregate = "out:A\n\nout:B\n\nout:C"
  [handoff] transferred = triage→specialist | output = RESOLVED
  [hierarchical] executed = mgr→w1→w2→mgr | output = MGR
  [group-chat] turns = a→b→a | output = A
  [group-chat] events = started:1 step_completed:3 completed:1
  ALL FIVE PRIMITIVES RAN OK
  ```
- **Cleanup:** none (`scratch/src/` is gitignored and non-persistent).

## Tasks

Archived: [`.agents/tasks/completed/SELFHOST-001.md`](../../tasks/completed/SELFHOST-001.md) — all P1/P2/P3 slices
`[x]` (sequential + contracts + SPEC amendment; parallel + handoff; hierarchical + group-chat).

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
- 2026-07-17 — **GATE-IMPLEMENT: P1 implemented** (moved todo/ → active/, status in-progress). Shipped the neutral
  contracts + event-type unions in `agent-core/src/orchestration/`, the `sequential` mechanism in
  `agent-framework/src/orchestration/sequential.ts` composing over `agent-executor`'s `ISubagentManager`/
  `ISubagentRunner` port, the standing `orchestration-neutrality` scan, and the agent-core/agent-framework SPEC
  amendments. TC-01..TC-06 satisfied and verified locally: build + typecheck + 5/5 tests + lint (0 errors) +
  `pnpm harness:scan` (all 54 scans pass). Tasks: [`.agents/tasks/SELFHOST-001.md`](../../tasks/SELFHOST-001.md).
  P2 (`parallel`/`handoff`) and P3 (`hierarchical`/`group-chat`) remain.
- 2026-07-17 — **GATE-IMPLEMENT: P2 implemented.** Added the `parallel` and `handoff` primitives. agent-core:
  `IParallelOrchestrationSpec` (bounded `maxConcurrency`) + `IHandoffOrchestrationSpec` (control-transfer among
  steps; `entryStepId` + `maxHandoffs` loop bound), still zero new `@robota-sdk/agent-*` deps. agent-framework:
  `runParallel` (bounded-concurrency worker pool, order-preserving results, joined aggregate) and `runHandoff`
  (dynamic loop-ownership transfer driven by an injected neutral `resolveHandoff` policy — keeping WHICH step
  receives control a caller decision so the primitive carries no app-domain routing; previous-output threading;
  `maxHandoffs` guard); spawn/wait/event mechanics factored into `orchestration/shared.ts` (also adopted by the
  refactored `sequential`). No `agent-subagent-runner` dep (no-cycle). The standing `orchestration-neutrality`
  floor already covers the new source and stays clean (guarding the still-pending P3 `hierarchical`/`group-chat`).
  SPEC amendments in both packages. Verified locally: build + typecheck + orchestration tests **17/17**
  (6 sequential + 6 parallel + 5 handoff) + lint (0 errors) + `pnpm harness:scan` (all **54** pass) + `harness:test`
  neutrality 5/5. P3 (`hierarchical`/`group-chat`) remains.
- 2026-07-17 — **GATE-IMPLEMENT: P3 implemented — epic feature-complete.** Added the final two primitives.
  agent-core: `IOrchestrationDelegation`, `IHierarchicalOrchestrationSpec` (`managerStepId` + `maxRounds`) and
  `IGroupChatOrchestrationSpec` (`firstStepId` + `maxTurns`), still zero new `@robota-sdk/agent-*` deps.
  agent-framework: `runHierarchical` (manager step delegates to workers via an injected neutral `planDelegation`
  policy; worker output aggregated + threaded back into the manager's next round; `maxRounds` guard) and
  `runGroupChat` (steps take turns chosen by an injected neutral `selectNextStep` policy; prior turns threaded as
  id-labeled history; `maxTurns` guard), both over the shared `orchestration/shared.ts` mechanics and the same
  `ISubagentManager`/`ISubagentRunner` port. **Neutrality held for the two highest-drift primitives** — the
  standing `orchestration-neutrality` floor covers the new source and is clean (0 findings); WHO delegates / WHO
  speaks next is a caller-injected policy, never baked-in routing (the adversarial risk called out in the
  Validated-Recommendation is thus mechanically closed). No `agent-subagent-runner` dep. SPEC amendments in both
  packages. Verified locally: build + typecheck + orchestration tests **30/30** (6 sequential + 7 parallel +
  5 handoff + 6 hierarchical + 6 group-chat) + lint (0 errors) + `pnpm harness:scan` (all **54** pass) +
  `harness:test` neutrality 5/5. **All five named primitives now implemented.** Next: GATE-VERIFY + GATE-COMPLETE
  (move `active/` → `done/` with done-evidence).

### [GATE-IMPLEMENT] — ✅ PASS | 2026-07-17

**Status upgrade:** approved → in-progress (recorded at P1; consolidated here across the epic's three slices)

- All five primitives implemented across P1 (`sequential`, PR #1192), P2 (`parallel`/`handoff`, PR #1194) and P3
  (`hierarchical`/`group-chat`, PR #1195) — each merged to `develop` and merge-verified. Tasks file
  `.agents/tasks/SELFHOST-001.md` created and its slice checklists all `[x]`; `## Tasks` records the path.
- Contracts + event-type unions owned by `agent-core/src/orchestration/`; mechanism in
  `agent-framework/src/orchestration/` composing over `agent-executor`'s `ISubagentManager`/`ISubagentRunner` port,
  spawn/wait/event mechanics factored into `shared.ts`. Standing `orchestration-neutrality` scan registered.
- NON-COMPLIANCE check: no implementation ahead of GATE-APPROVAL; each slice landed via its own reviewed PR.

### [GATE-VERIFY] — ✅ PASS | 2026-07-17

**Status upgrade:** in-progress → verifying

- Tasks completion: every checklist item in `.agents/tasks/SELFHOST-001.md` is `[x]` (P1 sequential + contracts +
  SPEC amendment; P2 parallel + handoff; P3 hierarchical + group-chat); none blocked or pending.
- Build: `pnpm --filter @robota-sdk/agent-core --filter @robota-sdk/agent-framework build` → exit 0.
- Tests: `pnpm --filter @robota-sdk/agent-core --filter @robota-sdk/agent-framework test` → agent-core **851/851**
  (59 files), agent-framework **1118/1118** (129 files); orchestration subset 30/30 (5 files). exit 0.

### [GATE-COMPLETE] — ✅ PASS | 2026-07-17

**Status upgrade:** verifying → done

- **[GATE-COMPLETE: TC-01]** Verified: `node scripts/harness/check-dependency-direction.mjs` (via `pnpm harness:scan`
  `deps`) → pass; `agent-core` carries zero new `@robota-sdk/agent-*` production deps (prod deps: `jssha`, `zod`).
  Checkbox `[x]`. Test reference: `deps` dependency-direction scan.
- **[GATE-COMPLETE: TC-02]** Verified: `pnpm --filter @robota-sdk/agent-framework test -- --run src/orchestration/__tests__/`
  → 30/30. Lifecycle-event assertions in `sequential.test.ts` ("emits the neutral lifecycle events") + the
  events assertions in `parallel.test.ts` / `handoff.test.ts` / `hierarchical.test.ts` / `group-chat.test.ts`.
  Checkbox `[x]`. Test reference: those five `packages/agent-framework/src/orchestration/__tests__/*.test.ts`.
- **[GATE-COMPLETE: TC-03]** Verified: same run — each primitive has a "composes end-to-end over a SubagentManager
  backed by an ISubagentRunner" case; `createInProcessSubagentRunner` referenced without an `agent-subagent-runner`
  dep. Checkbox `[x]`. Test reference: the end-to-end case in each `__tests__/*.test.ts`.
- **[GATE-COMPLETE: TC-04]** Verified: `deps`/one-way scan green — `agent-framework` does not depend on
  `agent-subagent-runner` (no cycle). Checkbox `[x]`. Test reference: `deps` scan.
- **[GATE-COMPLETE: TC-05]** Verified: `node scripts/harness/scan-orchestration-neutrality.mjs` → "scan passed"
  (0 findings) over `agent-core/src/orchestration` + `agent-framework/src/orchestration` incl. the P3
  `hierarchical`/`group-chat` source; `npx vitest run scripts/harness/__tests__/scan-orchestration-neutrality.test.mjs`
  → 5/5 (red-fixture proves failing-capability). Checkbox `[x]`. Test reference:
  `scripts/harness/scan-orchestration-neutrality.mjs` + its `__tests__` test.
- **[GATE-COMPLETE: TC-06]** Verified: `pnpm harness:scan` → all 54 scans pass incl. `docs-structure` +
  `spec-public-surface`; `agent-core/docs/SPEC.md` (Boundaries amendment + Orchestration Public API table with all
  contracts) and `agent-framework/docs/SPEC.md` (all five `runX` rows) updated. Checkbox `[x]`. Test reference:
  `docs-structure` + `spec-public-surface` scans.
- **Test Plan coverage:** all 6 rows have concrete test references (recorded under `## Test Plan`); no unaddressed row.
- **User-Execution done-gate:** PASS — `## User Execution Test Scenarios` UET-01 (`agent-executable`, public SDK
  surface) executed 2026-07-17 via `cd scratch && pnpm run run -- src/selfhost-001-orchestration-demo.ts`, exit 0,
  observed output captured in the scenario's evidence field (`ALL FIVE PRIMITIVES RAN OK` with each primitive's
  neutral composition outcome). The subagent runner is stubbed (credential-free, preference-order option 2) because
  the primitives own the COMPOSITION, not the LLM call.
- **Artifact actions:** tasks file archived `.agents/tasks/SELFHOST-001.md` → `.agents/tasks/completed/SELFHOST-001.md`;
  spec `## Tasks` updated to the archived path. Spec moved `spec-docs/active/` → `spec-docs/done/`, frontmatter
  `status: done` + `completed: 2026-07-17`.
- **Summary:** all 6 Completion Criteria `[x]` with matching GATE-COMPLETE evidence; Test Plan fully covered;
  User-Execution gate passed with captured evidence; tasks archived. Epic feature-complete (all five primitives).
  Status upgrade verifying → done authorized.
