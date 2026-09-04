---
status: approved
type: INFRA
tags: [process, harness]
lane: L1
---

# INFRA-160: plan-order cannot ground an L0 implementation that repairs several historical records

Paired with `.agents/tasks/INFRA-160-plan-order-cannot-ground-an-l0-implementation-that-repairs-several-historical-re.md`. Arising from [issue #2539](https://github.com/woojubb/robota/issues/2539).

## Problem

`node scripts/harness/scan-user-execution-plan-order.mjs --staged` refuses a valid L0 implementation
whose staged set edits more than one historical record. The refusal is
`✗ user-execution-plan-order: staged implementation has no planning checkpoint ancestor.` and it is
produced even when the governing Task's planning commits are ancestors on the branch.

Reproduction condition: an L0 Task whose implementation edits two or more completed Task or done spec
records with different basenames, staged together with the governing Task's own `todo` →
`completed/` archival move. The cause is `planningBasenames` at `:385-389`, which maps every staged
`.agents/tasks/**` and `.agents/spec-docs/<folder>/**` path to a planning-unit basename —
`taskBasename` (`:314-321`) strips a leading `completed/` and `specBasename` (`:323-331`) accepts the
`done` folder — so records the change merely EDITS are counted as additional planning units. With more
than one basename the staged branch sets `basename = null` (`:2352`), records the problem
`paths do not identify exactly one planning unit.` (`:2357`), and because that string does not carry
the `checkpoint-form near miss` prefix (`:1217`, tested at `:1248-1250`) it is reported through the
non-near-miss lead at `:2367-2371`.

Transplanting `TASK_PREFIX`, `SPEC_PREFIX`, `SPEC_FOLDERS`, `taskBasename`, `specBasename` and
`planningBasenames` verbatim into a standalone script and running the issue's exact four staged paths
through them produces:

```
planningBasenames -> 3 unit(s):
   DOCS-049-terminalize-trans008-docs024-harness124.md
   HARNESS-123-six-comment-strippers-four-behaviours-and-no-owner-so-a-comment-can-satisfy-a-sc.md
   INFRA-146-fresh-develop-fails-reference-kind-qualified-after-backlog-record-moves.md
basename = null
```

The L0 lane has no checkpoint pair to offer: `.agents/rules/spec-workflow.md` § Gates per lane states
_"L0 has no spec document and is judged by CI, the reviewer verdict and the merge gate"_, so the
staged branch reaches `proposed.pairs.length === 0` (`:2329`) and judges the change as a planning
PRELUDE, a form an implementation can never satisfy.

## Prior Art Research

Waived: the subject is this repository's own commit-ordering guard, whose criteria are defined by
`.agents/rules/backlog-execution.md` and `.agents/rules/spec-workflow.md` and by no external product.
There is no commercial or open-source tool whose documented behaviour bears on how THIS scan should
classify a staged path set; the authorities are the two rules and the scan's existing refusals.

## Architecture Review

### Affected Scope

- `scripts/harness/scan-user-execution-plan-order.mjs` — staged-mode classification
- `scripts/harness/__tests__/` — the fixture tests for the four preserved and one new behaviour

### Alternatives Considered

1. Separate the planning unit from the records the implementation edits, inside the staged classifier.
   - Pro: the smallest change that removes the demonstrated refusal; every existing refusal path is
     untouched because the change adds a distinction rather than removing a check.
   - Con: the distinction has to be derived from the staged change shape (added / deleted / modified),
     which the classifier does not read today.
2. Add an explicit L0 checkpoint artifact — a marker file or commit trailer the L0 lane must produce.
   - Pro: gives L0 the same shape L1 and L2 have, so one code path serves all three lanes.
   - Con: invents a new required artifact for the lane whose whole definition is that it has none;
     `spec-workflow.md` § Gates per lane would have to change, which is an L2 path
     (`L2 | .agents/rules/spec-workflow.md`) and a change to what the gates mean.
3. Exempt any staged set containing a completed/done record from the staged guard entirely.
   - Pro: one predicate, no new concepts.
   - Con: a real ungrounded implementation can include a completed record and would then pass; this
     removes the refusal the guard exists for, which the issue explicitly forbids
     (_"It must continue to reject implementation with no prior ground"_).

### Decision

**Alternative 1.** The defect is a classification error — a record being edited is being read as a
record being planned — so the correction belongs at the point of classification, not in the lane
definition and not in a blanket exemption. Alternative 2 buys uniformity at the price of changing the
gate-defining rule, a strictly larger blast radius than the demonstrated defect; Alternative 3 buys
simplicity by deleting the property under test.

The trade-off accepted: the classifier must learn to read the staged change SHAPE (a path that is
added, deleted, or modified) where today it reads only the path string. That is the cost of keeping
every existing refusal exactly as strict as it is.

**Delivery mode:** `single`

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: a single harness scan, not a CLI command family
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and no
      layer or product-family reclassification.

## Fallback & Degradation Declaration

None

## Solution

1. In the staged branch, derive the candidate planning unit from paths that represent a Task lifecycle
   transition or a pre-checkpoint planning pair, and exclude a completed/done record that the change
   only modifies.
2. Accept the staged set as an L0 implementation when an ancestor commit on the topic branch is a
   recognised planning unit for that basename and the staged set carries that unit's own archival move.
3. Leave every other branch of `findStagedFindings` unchanged, including the correction-checkpoint
   path (`:2303-2325`), the second-transition refusal (`:2316-2325`), the AGREEMENT prelude
   (`:2330-2349`) and the worktree-residue findings.
4. State the accepted L0 grounding form in the scan's own header comment, where its criteria are
   documented.

## Affected Files

- `scripts/harness/scan-user-execution-plan-order.mjs`
- `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs`
- `.agents/tasks/INFRA-160-plan-order-cannot-ground-an-l0-implementation-that-repairs-several-historical-re.md` (this pair)

## Completion Criteria

- [ ] TC-01: Command — the fixture test staging the issue's four-path shape over ancestor planning commits produces zero findings, and the same test fails against the pre-change classifier.
- [ ] TC-02: Command — the fixture test staging an implementation with no planning ancestor still produces the finding text `staged implementation has no planning checkpoint ancestor.`
- [ ] TC-03: Command — the fixture test staging a second work-unit checkpoint transition still produces a finding whose text begins `second work-unit planning checkpoint transition is staged after`.
- [ ] TC-04: Command — the fixture test for the issue #2469 pre-checkpoint terminal disposition still produces zero findings.
- [ ] TC-05: Command — `node scripts/harness/scan-user-execution-plan-order.mjs` exits 0 on this clone and prints one `::examined::` line ending in `topic commit(s)`.
- [ ] TC-06: Command — `pnpm harness:scan` exits 0.

## Test Plan

Derived from `type: INFRA` + `tags: [process, harness]` — CI pipeline smoke plus unit tests over the
exported classifier.

| TC-ID | Test Type | Tool / Approach                                           | Notes                                  |
| ----- | --------- | --------------------------------------------------------- | -------------------------------------- |
| TC-01 | automated | vitest over `findStagedFindings` in a fixture repository  | red-first: must fail before the change |
| TC-02 | automated | vitest over `findStagedFindings` in a fixture repository  | preserved refusal — no ground          |
| TC-03 | automated | vitest over `findStagedFindings` in a fixture repository  | preserved refusal — second transition  |
| TC-04 | automated | vitest over `findStagedFindings` in a fixture repository  | preserved acceptance — issue #2469     |
| TC-05 | automated | `node scripts/harness/scan-user-execution-plan-order.mjs` | history mode on the real clone         |
| TC-06 | automated | `pnpm harness:scan`                                       | registry smoke                         |

## User Execution Test Scenarios

Not applicable — the change is a repository commit-ordering guard used by the pre-commit and pre-push
paths, and it ships no CLI command, TUI action, browser flow, or public SDK surface an end user can
execute.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** No new CLI, TUI, browser, or SDK behaviour is introduced; the observable proof is the
guard's own fixture cases.

## Tasks

- [ ] `.agents/tasks/INFRA-160-plan-order-cannot-ground-an-l0-implementation-that-repairs-several-historical-re.md` — todo

## Evidence Log

### [GATE-APPROVAL] — ✅ PASS | 2026-09-05

**Status upgrade:** draft → approved
**Approval route:** `CLASS`
**Class:** `LANE-L0-L1`
**Instruction (verbatim):** "좋아 모두 승인한다. 빠르게 적용해줘. 필요하면 병렬 에이전트와 workflow를 적극 적용해줘"
**Given:** 2026-08-28, this conversation
**Evidence condition met:** `node scripts/harness/scan-lane-declaration.mjs --changed <2 path(s)> --diff-file <diff vs origin/develop> --trailers-file <Lane: L1>` over 2 changed path(s) — committed and working-tree changes vs origin/develop (merge base a81cc85b7d40) → exit 0, `lane-declaration summary: violations=0 result=PASS` (Lane L1 (spec-doc frontmatter .agents/spec-docs/draft/INFRA-160-plan-order-cannot-ground-an-l0-implementation-that-repairs-several-historical-re.md) is at or above the floor L0)
**Review fingerprint:** 1a09c4b15058 (review c3da2d7c, type/tags 7622c4ed)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <2)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (1a09c4b15058) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

**Judged at:** HEAD `a81cc85b7d40` · base `origin/develop@a81cc85b7d40` · document `.agents/spec-docs/draft/INFRA-160-plan-order-cannot-ground-an-l0-implementation-that-repairs-several-historical-re.md` blob `7fc640aa20f2` (untracked)

### [GATE-PLAN] — ✅ PASS | 2026-09-05

**Status upgrade:** draft → approved

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: INFRA` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (2 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 2142 chars, 6 sentences
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: `## Prior Art Research` section present
- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — All 4 checklist items are `[x]`: 5/5 checklist items `[x]`
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: Sibling scan `[x]` with an explicit N/A reason
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: 3 numbered alternatives, each with Pro and Con
- GATE-WRITE — Decision references the trade-off that drove the choice: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — **New-surface placement (conditional):** IF the spec introduces a new package / app / presentation or interfac: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Every item has a `TC-N` prefix (TC-01, TC-02, …) — items without TC-N prefix = FAIL: 6 criteria, all `TC-NN:` prefixed
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — No criterion uses: "works correctly", "no errors", "implemented", "displays correctly": none of "works correctly", "no errors", "implemented", "displays correctly" appears
- GATE-WRITE — `## Test Plan` section present: `## Test Plan` present
- GATE-WRITE — One row exists for each TC-N in Completion Criteria (count must match): 6 Test Plan rows = 6 TC criteria
- GATE-WRITE — Each row has a non-empty Test Type and Tool/Approach (no "TBD"): 6 rows with Test Type and Tool, no TBD
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
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (1a09c4b15058) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/INFRA-160-plan-order-cannot-ground-an-l0-implementation-that-repairs-several-historical-re.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/INFRA-160-plan-order-cannot-ground-an-l0-implementation-that-repairs-several-historical-re.md`, whose basename is the spec's
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`

**Judged at:** HEAD `a81cc85b7d40` · base `origin/develop@a81cc85b7d40` · document `.agents/spec-docs/draft/INFRA-160-plan-order-cannot-ground-an-l0-implementation-that-repairs-several-historical-re.md` blob `2d8624eee642` (untracked)
