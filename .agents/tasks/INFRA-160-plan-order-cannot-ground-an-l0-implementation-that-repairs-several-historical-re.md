---
title: 'INFRA-160: plan-order cannot ground an L0 implementation that repairs several historical records'
issue: https://github.com/woojubb/robota/issues/2539
status: todo
created: 2026-09-04
priority: medium
urgency: soon
area: scripts/harness
depends_on: []
---

# INFRA-160: plan-order cannot ground an L0 implementation that repairs several historical records

Registered by [issue #2539](https://github.com/woojubb/robota/issues/2539).

## Objective

Let the staged plan-order guard recognise an L0 implementation that is grounded by an ancestor
planning unit, without weakening the L1/L2 checkpoint ordering it exists to enforce.

## Verification of the issue's claim

**HOLDS — the cause is exactly where the issue says it is.** `planningBasenames` at
`scripts/harness/scan-user-execution-plan-order.mjs:385-389`:

```js
function planningBasenames(paths) {
  return [
    ...new Set(paths.map((file) => taskBasename(file) ?? specBasename(file)).filter(Boolean)),
  ].sort();
}
```

`taskBasename` (`:314-321`) strips a leading `completed/`, so a COMPLETED Task record yields a
basename indistinguishable from an open one. `specBasename` (`:323-331`) accepts any folder in
`SPEC_FOLDERS` (`:85`), which includes `done`. So every historical record the implementation edits is
counted as a planning unit.

**REPRODUCED.** The four functions above were transplanted verbatim into a standalone script and run
over the issue's exact staged path set:

```
$ node /tmp/repro2539.mjs
planningBasenames -> 3 unit(s):
   DOCS-049-terminalize-trans008-docs024-harness124.md
   HARNESS-123-six-comment-strippers-four-behaviours-and-no-owner-so-a-comment-can-satisfy-a-sc.md
   INFRA-146-fresh-develop-fails-reference-kind-qualified-after-backlog-record-moves.md
basename = null
=> preludeProblems = ["paths do not identify exactly one planning unit."]
=> isCheckpointNearMiss(...) = false (NEAR_MISS_PREFIX not matched)
=> finding: "staged implementation has no planning checkpoint ancestor."
```

This is a source-transplanted evaluation of the classification step, not an end-to-end run: producing
the real refusal needs a staged index over ancestor planning commits, which this session may not
create. The refusal text it derives is byte-identical to the one the issue reports, and the branch it
follows is fixed by `basename === null` at `:2352` → `:2354-2358` → `:2367-2371`, where
`isCheckpointNearMiss` (`:1248-1250`, prefix at `:1217`) is false for that problem string.

**HOLDS — the L0 lane genuinely has no checkpoint pair to offer.** `.agents/rules/spec-workflow.md`
§ Gates per lane: _"L0 has no spec document and is judged by CI, the reviewer verdict and the merge
gate"_. The staged branch of the scan reaches `proposed.pairs.length === 0` (`:2329`) and then judges
the change as a planning PRELUDE, which an implementation can never satisfy.

**STILL PRESENT.** No L0 accommodation was added since the issue was filed:

```
$ grep -c "L0" scripts/harness/scan-user-execution-plan-order.mjs
0
```

**THE REPORTED CASE WAS RESOLVED BY ABANDONING L0, NOT BY FIXING THE GUARD.** INFRA-146 shipped with
a full spec document at `lane: L2` (`.agents/spec-docs/done/INFRA-146-…md`, frontmatter `lane: L2`),
because one of its two targets — `DOCS-049` — carried an L2 declaration of its own. So the defect was
worked around, and the next L0 repair of several historical records meets it again.

## Scope Boundary

- Own the staged-mode classification of an L0 implementation and its grounding evidence.
- Preserve every existing refusal: no prior ground is still refused; a second L1/L2 checkpoint
  transition is still refused; a pre-checkpoint terminal disposition (issue #2469) is unchanged.
- Do NOT touch `scripts/harness/gate.mjs`, `run-all-scans.mjs`, `pre-push.mjs`, or
  `scan-lane-declaration.mjs` — all four are L2 paths and none is the cause.

## Lane

**Declared lane: L1.** The diff is a non-comment change to
`scripts/harness/scan-user-execution-plan-order.mjs` and its test. The § Lane floors table gives
`L1 | scripts/**#non-comment | Harness and tooling scripts — behaviour without a package contract`.
It is **not** L2: the table's L2 rows name four harness scripts individually —
`scan-lane-declaration.mjs`, `gate.mjs`, `run-all-scans.mjs`, `pre-push.mjs` — and this file is none
of them. L1 means one spec document and two gates, PLAN and DONE; the paired spec is
`.agents/spec-docs/draft/INFRA-160-…md`.

## Gate introduction order

This Task **loosens** an existing refusal rather than turning a gate on, so nothing that is green today
becomes red and no baseline needs freezing. The risk runs the other way: a change that should be
refused could start passing. The order therefore is red-first — every preserved refusal gets a test
that fails against the loosened classifier before the loosening lands, and the new acceptance gets a
test that fails against today's classifier.

## Plan

- [x] Add a failing test reproducing the issue's staged shape end-to-end through
      `findStagedFindings`, over a fixture repository with the ancestor planning commits.
- [x] Add failing tests for each preserved refusal: no ancestor at all; a second checkpoint
      transition staged; a pre-checkpoint terminal disposition.
- [ ] Separate "the planning unit" from "a record the implementation edits" in the staged
      classification, so a completed/done record that is only edited is not counted as a unit.
- [x] Define the L0 grounding form the scan accepts, and state it where the scan's header documents
      its criteria.
- [x] Run the full staged and history modes on this clone and record the `::examined::` lines.

## Completion Criteria

- TC-01: Command — the new fixture test asserting the issue's four-path staged shape produces zero findings passes, and fails on the pre-change classifier.
- TC-02: Command — a fixture test staging an implementation with no planning ancestor still produces the finding `staged implementation has no planning checkpoint ancestor.`
- TC-03: Command — a fixture test staging a second work-unit checkpoint transition still produces the `second work-unit planning checkpoint transition is staged after` finding.
- TC-04: Command — a fixture test for the issue #2469 pre-checkpoint terminal disposition still produces zero findings.
- TC-05: Command — `node scripts/harness/scan-user-execution-plan-order.mjs` exits 0 on this clone and prints an `::examined::` line.
- TC-06: Command — `pnpm harness:scan` exits 0.

## Test Plan

| TC-ID | Test Type | Tool / Approach                                           | Notes                                           |
| ----- | --------- | --------------------------------------------------------- | ----------------------------------------------- |
| TC-01 | automated | vitest over `findStagedFindings` in a fixture repository  | the red-first case; must fail before the change |
| TC-02 | automated | vitest over `findStagedFindings` in a fixture repository  | preserved refusal — no ground                   |
| TC-03 | automated | vitest over `findStagedFindings` in a fixture repository  | preserved refusal — second transition           |
| TC-04 | automated | vitest over `findStagedFindings` in a fixture repository  | preserved acceptance — issue #2469              |
| TC-05 | automated | `node scripts/harness/scan-user-execution-plan-order.mjs` | history mode on the real clone                  |
| TC-06 | automated | `pnpm harness:scan`                                       | registry smoke                                  |

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** The change is a repository commit-ordering guard used by the pre-commit and pre-push paths.
It ships no CLI command, TUI action, browser flow, or public SDK surface, so no end user can execute
anything to observe it; the guard's own red and green fixture cases belong in `## Test Plan`.
