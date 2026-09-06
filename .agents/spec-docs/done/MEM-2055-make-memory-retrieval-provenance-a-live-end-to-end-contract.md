---
status: done
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

- [x] TC-01: `pnpm --filter @robota-sdk/agent-framework exec vitest run src/interactive/__tests__/interactive-session-recall.test.ts` → exits 0, and TC-07/TC-08/TC-09 exit 1 with the F11 fix reverted
- [x] TC-02: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts --skip work-run-measurement` → exits 0 (work-run-measurement skipped to match `ci.yml`/`scans-full.yml`, which both exclude it — INFRA-174)
- [x] TC-03: `pnpm --filter @robota-sdk/agent-framework test && pnpm --filter @robota-sdk/agent-cli test` → exits 0 on both whole suites, not only the new cases

## Test Plan

| TC-ID | Test Type | Tool / Approach                                                     | Notes                                                           |
| ----- | --------- | ------------------------------------------------------------------- | --------------------------------------------------------------- |
| TC-01 | Unit      | `vitest run interactive-session-recall.test.ts` (TC-07/08/09)       | RED with F11 fix reverted (no provenance/events), GREEN with it |
| TC-02 | Suite     | `run-all-scans.mjs --affected --context pr`                         | Regression — the affected set, not the full suite               |
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

- [x] `.agents/tasks/completed/MEM-2055-make-memory-retrieval-provenance-a-live-end-to-end-contract.md` — done

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

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-09-07

**Command:** `pnpm --filter @robota-sdk/agent-framework exec vitest run src/interactive/__tests__/interactive-session-recall.test.ts`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
1:24:11 AM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /private/tmp/robota-worktrees/mem-001-v2/packages/agent-framework

 ✓ src/interactive/__tests__/interactive-session-recall.test.ts (8 tests) 25ms

 Test Files  1 passed (1)
      Tests  8 passed (8)
   Start at  01:24:11
   Duration  691ms (transform 349ms, setup 0ms, collect 531ms, tests 25ms, environment 0ms, prepare 32ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `84835499b618` · base `origin/develop@35f1d907e0b5` · document `.agents/spec-docs/todo/MEM-2055-make-memory-retrieval-provenance-a-live-end-to-end-contract.md` blob `755ccfa4c7bd` (modified)

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-09-07

**Command:** `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts --skip work-run-measurement`
**Exit:** 0
**Output:** (last 10 of 137 line(s))

```
✓ docs-structure

⚑ 3 advisory finding(s) — NOT failures. The verdict below is unaffected.
⚑ spec-whitebox-leakage: packages/agent-framework/docs/SPEC.md: 2235/3071 lines (72.8%) outside the standard sections — consider extracting to docs/design/
⚑ spec-whitebox-leakage: packages/agent-session/docs/SPEC.md: 349/791 lines (44.1%) outside the standard sections — consider extracting to docs/design/
⚑ progress-report-quantification: progress-report quantification examined 0 transcript(s) — no session transcript for this workspace at /Users/jungyoun/.claude/projects/-private-tmp-robota-worktrees-mem-001-v2; the agent-narrative channel does not exist on this host (e.g. CI or a fresh checkout), so nothing was judged.

117 scans passed, 2 skipped (119 declared what they examined)
scan receipt NOT written: working tree is not clean: M  packages/agent-cli/src/startup/__tests__/memory-enablement.test.ts, M  packages/agent-cli/src/startup/memory-enablement.ts, M  packages/agent-framework/src/interactive/__tests__/interactive-session-auto-capture.test.ts, M  packages/agent-framework/src/interactive/__tests__/interactive-session-recall.test.ts, M  packages/agent-framework/src/interactive/interactive-session-execution-controller.ts, M  packages/agent-framework/src/interactive/interactive-session-history-tracker.ts, M  packages/agent-framework/src/interactive/interactive-session-prompt.ts, M  packages/agent-framework/src/interactive/interactive-session.ts, M  packages/agent-framework/src/memory/__tests__/automatic-memory.test.ts, M  packages/agent-framework/src/memory/__tests__/file-system-memory-store.test.ts, M  packages/agent-framework/src/memory/__tests__/semantic-memory-store.test.ts, M  packages/agent-framework/src/memory/automatic-memory-controller.ts, M  packages/agent-framework/src/memory/automatic-memory-types.ts, M  scripts/harness/file-size-baseline.json
EXIT:0
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `84835499b618` · base `origin/develop@35f1d907e0b5` · document `.agents/spec-docs/todo/MEM-2055-make-memory-retrieval-provenance-a-live-end-to-end-contract.md` blob `f795a4c289c9` (modified)

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-09-07

**Command:** `pnpm --filter @robota-sdk/agent-framework test && pnpm --filter @robota-sdk/agent-cli test`
**Exit:** 0
**Output:** (last 10 of 343 line(s))

```
 ✓ src/startup/__tests__/diagnose-settings-path.test.ts (3 tests) 2ms
 ✓ src/modes/__tests__/org-policy-projection.test.ts (2 tests) 1ms
 ↓ src/init/__tests__/sec-020-runtime-data-ignore.test.ts (5 tests | 5 skipped)

 Test Files  66 passed | 1 skipped (67)
      Tests  475 passed | 18 skipped (493)
   Start at  01:24:36
   Duration  5.05s (transform 981ms, setup 0ms, collect 7.83s, tests 4.79s, environment 5ms, prepare 2.10s)

EXIT:0
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `84835499b618` · base `origin/develop@35f1d907e0b5` · document `.agents/spec-docs/todo/MEM-2055-make-memory-retrieval-provenance-a-live-end-to-end-contract.md` blob `c1e98ba063ae` (modified)

### [GATE-DONE] — ✅ PASS | 2026-09-07

**Status upgrade:** approved → done

**Ordering check:** `[GATE-PLAN] — ✅ PASS | 2026-09-07` recorded above (`draft → approved`); re-run rule `recorded-pass` for this row — `Y` of that entry's Status-upgrade line ("approved") equals the document's current `status:` ("approved"). Document location `.agents/spec-docs/todo/` agrees with `approved` per `spec-workflow.md` § Spec-Document Status and Lifecycle Folders. Ordering check PASSES.

- GATE-VERIFY — Every item in the `## Plan` section of `.agents/tasks/<ID>.md` is marked complete (`[x]`): `gate.mjs` reported `PENDING-GUARDIAN` — its `verifyChecks()` binds this criterion by the stale pattern `/All tasks in .agents\/tasks\/<ID>\.md are marked complete/i`, which no longer matches the catalogue's current (issue #2375) wording, so no judgement bound (tool defect, not a document defect). Guardian read `.agents/tasks/MEM-2055-make-memory-retrieval-provenance-a-live-end-to-end-contract.md` `## Plan` directly (lines 46-64): 6/6 items `[x]`, 0 unchecked.
- GATE-VERIFY — No Plan item is blocked or pending: same stale-pattern `PENDING-GUARDIAN` (bound regex `/No tasks are blocked or pending/i` does not match the current wording). Guardian read: none of the 6 Plan items contain "blocked"/"pending" language and none is unchecked; `node scripts/harness/scan-task-plan-items.mjs` corroborates — 260 Task Plan sections examined, scan passed (0 `plan-names-own-disposition` / `done-plan-item-unchecked` findings for this Task).
- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): independently re-run (not merely cited) — `pnpm --filter @robota-sdk/agent-framework build` → exit 0 (tsdown, CJS+ESM, "Build complete"); `pnpm --filter @robota-sdk/agent-cli build` → exit 0 (tsdown, CJS+ESM, "Build complete"). Both are the packages named in `## Architecture Review > Affected Scope`.
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): independently re-run — `pnpm --filter @robota-sdk/agent-framework test` → exit 0, 210 passed | 8 skipped test files, 1649 passed | 74 skipped tests; `pnpm --filter @robota-sdk/agent-cli test` → exit 0, 66 passed | 1 skipped test files, 475 passed | 18 skipped tests.
- GATE-COMPLETE — TC-01/TC-02/TC-03 checkboxes `[x]` in `## Completion Criteria`: confirmed, all 3 `[x]`.
- GATE-COMPLETE — a `[GATE-COMPLETE: TC-N]` entry with command/output/exit exists for each TC-N: confirmed present above for TC-01 (exit 0), TC-02 (exit 0), TC-03 (exit 0), each `Judged by: gate.mjs mechanical evaluator`.
- GATE-COMPLETE — `## Test Plan` carries a test reference or skip reason for every TC-N, none silently unaddressed: TC-01 names `interactive-session-recall.test.ts` (TC-07/08/09); TC-02 names the affected-scope scan command; TC-03 names the two whole-suite commands — all Tool/Approach cells non-empty, no TC-N without a reference.
- GATE-COMPLETE — `## Tasks` names the exact active task path: `.agents/tasks/MEM-2055-make-memory-retrieval-provenance-a-live-end-to-end-contract.md`, which exists.
- GATE-COMPLETE — that active task is completion-ready (all tasks `[x]`, none pending/blocked): same finding as the two GATE-VERIFY Plan criteria above — 6/6 `[x]`, none blocked/pending.

**Judged by:** `backlog-gate-guard` (semantic judgement for the two GATE-VERIFY criteria `gate.mjs` could not bind to their current wording — tool defect, not a document defect; the remaining GATE-VERIFY/GATE-COMPLETE criteria independently corroborated rather than merely re-cited).
**Judged at:** HEAD `84835499b618` · base `origin/develop@35f1d907e0b5` · document `.agents/spec-docs/todo/MEM-2055-make-memory-retrieval-provenance-a-live-end-to-end-contract.md` blob `23d4222d5e56` (modified)
