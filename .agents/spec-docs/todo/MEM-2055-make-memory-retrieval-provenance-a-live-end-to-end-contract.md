---
status: approved
type: BEHAVIOR
tags: [mem]
lane: L1
---

# MEM-2055: make memory retrieval provenance a live end-to-end contract

Paired with `.agents/tasks/MEM-2055-make-memory-retrieval-provenance-a-live-end-to-end-contract.md`. Arising from [issue #2055](https://github.com/woojubb/robota/issues/2055).

## Problem

With memory enabled, every recall injects `<recalled-memory>` content into the turn invisibly: the
declared `memory_retrieved` event never fires, `usedMemoryReferences` provenance is never written, and
`/memory used` is constitutionally empty. Separately, two recall-budget contracts claim ownership — the
one embedded in `IAutomaticMemoryConfig.retrieval` (a required field) is read only by a controller
method (`AutomaticMemoryController.retrieve()`) with no production callers, so tuning it changes
nothing; live per-turn recall budgeting comes from the separate `recallMemory.budget` seam.

Reproduction (before fix): enable memory, store a fact, send a prompt whose recall matches it, then run
`/memory used` — it reports "(no memory used in current turn)" even though `<recalled-memory>` content
was injected into that same turn.

## Prior Art Research

Waived: internal contract-completion fix with no external contract change — `memory_event` and
`usedMemoryReferences` are already-declared internal contracts (`agent-interface-session`,
`interactive-session-history-tracker.ts`); this closes a dead emit-site/write-site gap in an existing
design, it does not introduce a new one.

## Architecture Review

### Affected Scope

- `packages/agent-framework` (`src/interactive/*`, `src/memory/*`)
- `packages/agent-cli` (`src/startup/memory-enablement.ts`)

### Alternatives Considered

1. **Wire provenance at the recall call site, and delete the dead duplicate budget field.**
   - Pro: fixes both findings (F11, F12) at their actual source, with no new surface or contract.
   - Con: touches two independent-seeming findings in one Task; justified because both live in the
     same recall path and the F12 fix is a 4-line deletion once F11 is understood.
2. **Route `recallTurnMemory` through `AutomaticMemoryController.retrieve()` instead of deleting
   `retrieval`,** so the existing field becomes live rather than removed.
   - Pro: preserves the field; no config-shape change for callers.
   - Con: introduces a NEW behavior nothing in the Problem asked for — capture policy (`disabled` /
     `approval_required` / `auto_save`) would start gating recall, a cross-cutting policy change the
     issue never raised. Recall already has its own budget contract (`IPerTurnRecallConfig`); keeping
     two contracts for the same knob is exactly finding F12.

### Decision

**Alternative 1.** Fixing both findings at the recall call site is the minimal change that removes the
symptom without inventing a new capture/recall coupling; alternative 2 was rejected specifically because
it would resolve a duplicate-contract finding by making the duplication load-bearing instead of removing
it.

Validated before approval: every consumer of `IAutomaticMemoryConfig.retrieval` was enumerated (`grep -rn
"\.retrieval\b" packages/*/src`) — the sole reader was the dead `AutomaticMemoryController.retrieve()`
method itself, confirming the field has no other production or test consumer whose capability the
removal would silently drop. `IMemoryRetrievalResult` (the shared return type) stays exported and used
by `renderRetrievedMemory`/`renderPerTurnRecall`, so no capability is lost — only the unread input field
and its sole reader are removed.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — grepped every `.retrieval` and `.retrieve(` call site across the workspace;
      no sibling surface (agent-command, agent-transport-tui) reads either.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification; this only wires an existing internal event and
      collapses an existing dead field.

## Fallback & Degradation Declaration

None

## Solution

1. **F11 — wire recall provenance.** Add
   `InteractiveSessionHistoryTracker.recordUsedMemoryReferences(references)`, mirroring the existing
   `recordMemoryEvent` SSOT-recording pattern. In `InteractiveSession.recallTurnMemory()`, after a
   non-empty `store.recall()` result, call it with `result.references` and emit one `memory_retrieved`
   `memory_event` per reference (`topic`, `data: { path, score, truncated }`). Fix a reset-ordering
   hazard found while implementing this: `resetUsedMemoryReferences()` previously ran inside
   `executePromptTurn`, which executes AFTER `recallTurnMemory` — so a reference written that turn was
   wiped before it could persist. Move the reset into the execution controller, immediately before the
   recall call, so exactly one reset happens per turn, before recall runs.
2. **F12 — collapse the duplicate recall-budget contract.** Delete
   `AutomaticMemoryController.retrieve()` (the sole reader of `retrieval`) and drop the `retrieval`
   field from `IAutomaticMemoryConfig`; `IPerTurnRecallConfig.budget` remains the one live recall-budget
   contract. Update `agent-cli`'s `buildMemorySessionOptions` and every affected test in both packages
   for the simplified config shape.

## Affected Files

- `packages/agent-framework/src/interactive/interactive-session-history-tracker.ts`
- `packages/agent-framework/src/interactive/interactive-session.ts`
- `packages/agent-framework/src/interactive/interactive-session-execution-controller.ts`
- `packages/agent-framework/src/interactive/interactive-session-prompt.ts`
- `packages/agent-framework/src/memory/automatic-memory-types.ts`
- `packages/agent-framework/src/memory/automatic-memory-controller.ts`
- `packages/agent-cli/src/startup/memory-enablement.ts`
- Tests: `interactive-session-recall.test.ts`, `interactive-session-auto-capture.test.ts`,
  `automatic-memory.test.ts`, `file-system-memory-store.test.ts`, `semantic-memory-store.test.ts`,
  `memory-enablement.test.ts`

## Completion Criteria

- [ ] TC-01: `pnpm --filter @robota-sdk/agent-framework exec vitest run src/interactive/__tests__/interactive-session-recall.test.ts` → exits 0, and TC-07/TC-08/TC-09 exit 1 with the F11 fix reverted
- [ ] TC-02: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` → exits 0
- [ ] TC-03: `pnpm --filter @robota-sdk/agent-framework test && pnpm --filter @robota-sdk/agent-cli test` → exits 0 on both whole suites, not only the new cases

## Test Plan

| TC-ID | Test Type | Tool / Approach                                                    | Notes                                                          |
| ----- | --------- | ------------------------------------------------------------------- | --------------------------------------------------------------- |
| TC-01 | Unit      | `vitest run interactive-session-recall.test.ts` (TC-07/08/09)       | RED with F11 fix reverted (no provenance/events), GREEN with it |
| TC-02 | Suite     | `run-all-scans.mjs --affected --context pr`                          | Regression — the affected set, not the full suite               |
| TC-03 | Unit      | `pnpm --filter @robota-sdk/agent-framework test` + `agent-cli test` | Whole suites: no regression from the F12 config-shape change    |

## User Execution Test Scenarios

**Applies** — `/memory used` is a user-facing CLI command whose output this fix changes directly.

**Author verdict:** `SCENARIO DRAFTED: manual | 1`

- Prerequisites: built CLI + provider key; memory enabled; a stored memory the next prompt will recall.
- Steps: send a prompt that recalls the stored memory, then run `/memory used`.
- Expected (after fix): `/memory used` lists the recalled memory reference(s).
- Expected (before fix, contrast): `/memory used` says "(no memory used in current turn)" even though a
  memory was injected into the turn.
- Cleanup: clear the stored memory.
- Evidence: automated proof stands in for a manual run — TC-01 (`interactive-session-recall.test.ts`
  TC-07/TC-08/TC-09) asserts `getUsedMemoryReferences()` and the emitted `memory_retrieved` `memory_event`s
  directly, the same code path `/memory used` reads; the live end-to-end run needs a real provider
  session this record cannot spin up standalone.

## Tasks

- [ ] `.agents/tasks/MEM-2055-make-memory-retrieval-provenance-a-live-end-to-end-contract.md` — todo

## Evidence Log

### [GATE-APPROVAL] — ✅ PASS | 2026-09-07

**Status upgrade:** draft → approved
**Approval route:** `CLASS`
**Class:** `LANE-L0-L1`
**Instruction (verbatim):** "좋아 모두 승인한다. 빠르게 적용해줘. 필요하면 병렬 에이전트와 workflow를 적극 적용해줘"
**Given:** 2026-09-07, this conversation
**Evidence condition met:** `node scripts/harness/scan-lane-declaration.mjs --changed <2 path(s)> --diff-file <diff vs origin/develop> --trailers-file <Lane: L1>` over 2 changed path(s) — committed and working-tree changes vs origin/develop (merge base 35f1d907e0b5) → exit 0, `lane-declaration summary: violations=0 result=PASS` (Lane L1 (spec-doc frontmatter .agents/spec-docs/draft/MEM-2055-make-memory-retrieval-provenance-a-live-end-to-end-contract.md) is at or above the floor L0)
**Review fingerprint:** 42ee6703a1ab (review 8e233ad0, type/tags a241b66f)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <2)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (42ee6703a1ab) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `35f1d907e0b5` · base `origin/develop@35f1d907e0b5` · document `.agents/spec-docs/draft/MEM-2055-make-memory-retrieval-provenance-a-live-end-to-end-contract.md` blob `24e902fca1e4` (untracked)

### [GATE-PLAN] — ✅ PASS | 2026-09-07

**Status upgrade:** draft → approved

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: BEHAVIOR` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (1 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 835 chars, 3 sentences
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: `## Prior Art Research` section present
- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — All 4 checklist items are `[x]`: 5/5 checklist items `[x]`
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: Sibling scan `[x]` with completion evidence
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: 2 numbered alternatives, each with Pro and Con
- GATE-WRITE — Decision references the trade-off that drove the choice: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — **New-surface placement (conditional):** IF the spec introduces a new package / app / presentation or interfac: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Every item has a `TC-N` prefix (TC-01, TC-02, …) — items without TC-N prefix = FAIL: 3 criteria, all `TC-NN:` prefixed
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — No criterion uses: "works correctly", "no errors", "implemented", "displays correctly": none of "works correctly", "no errors", "implemented", "displays correctly" appears
- GATE-WRITE — `## Test Plan` section present: `## Test Plan` present
- GATE-WRITE — One row exists for each TC-N in Completion Criteria (count must match): 3 Test Plan rows = 3 TC criteria
- GATE-WRITE — Each row has a non-empty Test Type and Tool/Approach (no "TBD"): 3 rows with Test Type and Tool, no TBD
- GATE-WRITE — Rows where Tool is "manual" have a non-empty Notes entry explaining why automated test is not possible: 0 manual row(s), each with Notes
- GATE-WRITE — Tasks section present with placeholder: `## Tasks` present
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` present with 1 prior entry (none from a later gate)
- GATE-WRITE — No `## Status` or `## Classification` sections in the body (these are frontmatter fields): no `## Status` / `## Classification` body sections
- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <2)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (42ee6703a1ab) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/MEM-2055-make-memory-retrieval-provenance-a-live-end-to-end-contract.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/MEM-2055-make-memory-retrieval-provenance-a-live-end-to-end-contract.md`, whose basename is the spec's
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: manual | 1`

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `35f1d907e0b5` · base `origin/develop@35f1d907e0b5` · document `.agents/spec-docs/draft/MEM-2055-make-memory-retrieval-provenance-a-live-end-to-end-contract.md` blob `f7cb25617a96` (untracked)
