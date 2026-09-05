---
status: in-progress
type: INFRA
tags: [infra]
lane: L2
---

# INFRA-175: shrink gate.mjs and run-all-scans.mjs back under their frozen file-size baselines

Paired with `.agents/tasks/INFRA-175-shrink-gate-and-run-all-scans-back-under-their-frozen-file-size-baselines.md`.
Arising from [issue #2596](https://github.com/woojubb/robota/issues/2596).

<!-- lane corrected 2026-09-06: declared L1, refused by `scripts/harness/scan-lane-declaration.mjs` — `.agents/rules/spec-workflow.md` § Lane floors sets a floor of L2 for `scripts/harness/gate.mjs` and `scripts/harness/run-all-scans.mjs`, both of which this item changes. The declaration is raised to the floor rather than the change narrowed. Nothing else is edited: the Evidence Log below, including the recorded GATE-APPROVAL and GATE-PLAN passes, is the L1 run's and stands. -->

## Problem

Measured on `origin/develop`, with nothing from any topic branch:

```
scripts/harness/gate.mjs: 2605 lines, baseline 2560
scripts/harness/run-all-scans.mjs: 1931 lines, baseline 1914
```

`node scripts/harness/scan-file-size.mjs` therefore exits 1 with two `file-grew-past-baseline`
findings. `file-size` scans the whole repository unconditionally — it does not honour `--affected` —
and it is a member of the scan suite, so `develop` is red and so is every branch cut from it. The
issue records three consecutive `scans-full` failures on develop and two unrelated pull requests
blocked behind them.

## Prior Art Research

Waived: this is a move of functions between two of this repository's own build-tooling modules. No
external product documentation, protocol specification or release note bears on where a local harness
module's functions live. The precedent that governs it is internal and is cited in § Solution.

## Architecture Review

### Affected Scope

Two harness modules, two new sibling modules, and the frozen size baseline. No package, no app, no
shipped surface, and no harness RULE — the moved code keeps its behaviour exactly.

### Sibling scan

Every other entry in `scripts/harness/file-size-baseline.json` was checked against its file's current
length; only these two exceed their frozen numbers. The repository already uses the split-and-re-export
shape twice: `scripts/harness/family-siblings.mjs` consumed by
`scripts/harness/check-dependency-direction.mjs`, and `scripts/harness/required-status-checks-live.mjs`
re-exported from `scripts/harness/scan-main-required-checks.mjs`.

### Alternatives Considered

1. **A1 — raise both baseline numbers.** Pro: one line, no code moves, immediate green. Con: the scan's
   own finding text refuses the direction — "Pre-existing debt may shrink but never grow — split
   instead of extending" — and a raised baseline is debt adopted silently, which is the failure the
   ratchet exists to prevent. REJECTED.
2. **A2 — split each file into several modules by full responsibility decomposition.** Pro: gets both
   files near the 300-line policy rather than merely under their frozen numbers. Con: it rewrites two
   of the most load-bearing files in the harness in one change, and every consumer becomes a review
   surface. The debt is real but it is not this item's debt; the issue asks for develop to be green.
   REJECTED as scope.
3. **A3 — move one cohesive group out of each file into a sibling module and re-export it (CHOSEN).**
   Pro: consumers are unchanged because the original module still exports every name; each extracted
   group is chosen by responsibility so the new module has a nameable subject; both files fall
   comfortably below their frozen numbers, leaving headroom. Con: both files remain far above the
   300-line policy and stay baselined debt, which this document states rather than hides.

### Decision

A3. `gate.mjs` gives up the GATE-APPROVAL class-evidence group — the only part of the gate that spawns
git and a child scan, so it has a different failure mode from the document-parsing criteria around it.
`run-all-scans.mjs` gives up the affected-scan selection group, which never imports the registry (the
scan list is a parameter), so its rules stay testable against a fixture list.

The extraction has one hazard worth naming, because it was hit and fixed in an adjacent change the same
day: `scripts/harness/scan-rule-statement-floor.mjs` reads rule identifiers out of the STRING LITERALS
of `scripts/harness/*.mjs`. Moving code that emits `[SOME-IDENTIFIER]` can make the floor stop seeing
that identifier while the scan still passes — fewer identifiers to check is a green for the wrong
reason. TC-02 pins the count against `origin/develop` rather than merely asserting exit 0.

**Delivery mode:** `single`

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — 2 modules, 2 new siblings, 1 baseline file, listed in § Affected Files
- [x] Sibling scan 완료 — every baseline entry checked; two internal precedents for the shape, named in § Sibling scan
- [x] 대안 최소 2개 검토 완료 — 3 alternatives with pro/con, and the scan text that rejects A1 quoted
- [x] 결정 근거 문서화 완료 — § Decision, including the named extraction hazard and the criterion that guards it

## Fallback & Degradation Declaration

No runtime behaviour changes: every moved function keeps its signature and is re-exported from its
original module, so no consumer has a new failure mode. If an extraction is wrong the consumer suites
in TC-04 go red, which is the same signal that would catch it before the move.

## Solution

Move the GATE-APPROVAL class-evidence group out of `scripts/harness/gate.mjs` into
`scripts/harness/gate-class-evidence.mjs`, and the affected-scan selection group out of
`scripts/harness/run-all-scans.mjs` into `scripts/harness/affected-scan-selection.mjs`. Re-export both
from the original modules so no consumer changes. Then tighten
`scripts/harness/file-size-baseline.json` in the same commit, because an unlocked gain is a licence to
grow back.

## Affected Files

- `scripts/harness/gate.mjs` — shrinks, re-exports the moved group
- `scripts/harness/run-all-scans.mjs` — shrinks, re-exports the moved group
- `scripts/harness/gate-class-evidence.mjs` — new
- `scripts/harness/affected-scan-selection.mjs` — new
- `scripts/harness/file-size-baseline.json` — both entries lowered

## Completion Criteria

- [ ] TC-01: `node scripts/harness/scan-file-size.mjs` exits 0 and its baseline diff LOWERS both
      numbers and raises none.
- [ ] TC-02: `node scripts/harness/scan-rule-statement-floor.mjs` exits 0 and its
      `::examined:: <n> rule identifiers` count is not lower than the count on `origin/develop`.
- [ ] TC-03: `node scripts/harness/scan-measurement-provenance.mjs` exits 0 with its subject and
      reader counts unchanged.
- [ ] TC-04: the three consumer suites pass with no consumer file edited.
- [ ] TC-05: the full harness suite has no failure absent on `origin/develop`, established by running
      the identical suite in a detached worktree at `origin/develop` and set-comparing failing names.

## Test Plan

| TC-ID | Test Type | Tool / Approach                                                                      | Notes                                |
| ----- | --------- | ------------------------------------------------------------------------------------ | ------------------------------------ |
| TC-01 | CI smoke  | `scan-file-size.mjs` exit code plus the baseline diff                                | red today on both files              |
| TC-02 | CI smoke  | `scan-rule-statement-floor.mjs`, count compared to develop                           | guards the silent-blinding failure   |
| TC-03 | CI smoke  | `scan-measurement-provenance.mjs`                                                    | a moved reader must stay reachable   |
| TC-04 | unit      | `gate.test.mjs`, `run-all-scans-affected.test.mjs`, `scan-lane-declaration.test.mjs` | re-exports keep consumers unedited   |
| TC-05 | unit      | full suite here vs. a detached worktree at `origin/develop`                          | separates inherited red from new red |

No new fixture test is added: this moves code without changing behaviour, and TC-02 is the criterion
that fails if the extraction blinds a scan.

## User Execution Test Scenarios

Not applicable.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This item relocates functions between four of the repository's own internal maintenance
scripts so a size scan over those scripts stops reporting growth. Nothing it touches is published,
installed, or reachable from any command a person outside this repository can run — there is no
screen, no CLI flag, no SDK entry point and no file a user of Robota ever sees, so there is no
surface on which a scenario could be performed.

## Tasks

`.agents/tasks/INFRA-175-shrink-gate-and-run-all-scans-back-under-their-frozen-file-size-baselines.md`

## Evidence Log

### [GATE-APPROVAL] — ✅ PASS | 2026-09-06

**Status upgrade:** draft → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "지금부터 한시간 안에 3개 이상 develop브랜치에 머지 완료 처리하세요. 완료 목표치 10개 ... 이 심각한 문제를 해결할 때까지 반복하세요."
**Given:** 2026-09-06, this conversation
**Review fingerprint:** 7fc159a2dfbf (review a560dbe8, type/tags 2433998c)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-06, this conversation
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (7fc159a2dfbf) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

**Judged at:** HEAD `ffa7ca253320` · base `origin/develop@ffa7ca253320` · document `.agents/spec-docs/todo/INFRA-175-shrink-gate-and-run-all-scans-back-under-their-frozen-file-size-baselines.md` blob `b0c94f173ab9` (untracked)

### [GATE-PLAN] — ✅ PASS | 2026-09-06

**Status upgrade:** draft → approved

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: INFRA` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (1 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 600 chars, 3 sentences
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: `## Prior Art Research` section present
- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — All 4 checklist items are `[x]`: 4/4 checklist items `[x]`
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: Sibling scan `[x]` with completion evidence
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: 3 numbered alternatives, each with Pro and Con
- GATE-WRITE — Decision references the trade-off that drove the choice: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — **New-surface placement (conditional):** IF the spec introduces a new package / app / presentation or interfac: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Every item has a `TC-N` prefix (TC-01, TC-02, …) — items without TC-N prefix = FAIL: 5 criteria, all `TC-NN:` prefixed
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — No criterion uses: "works correctly", "no errors", "implemented", "displays correctly": none of "works correctly", "no errors", "implemented", "displays correctly" appears
- GATE-WRITE — `## Test Plan` section present: `## Test Plan` present
- GATE-WRITE — One row exists for each TC-N in Completion Criteria (count must match): 5 Test Plan rows = 5 TC criteria
- GATE-WRITE — Each row has a non-empty Test Type and Tool/Approach (no "TBD"): 5 rows with Test Type and Tool, no TBD
- GATE-WRITE — Rows where Tool is "manual" have a non-empty Notes entry explaining why automated test is not possible: 0 manual row(s), each with Notes
- GATE-WRITE — Tasks section present with placeholder: `## Tasks` present
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` present with 1 prior entry (none from a later gate)
- GATE-WRITE — No `## Status` or `## Classification` sections in the body (these are frontmatter fields): no `## Status` / `## Classification` body sections
- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-06, this conversation
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (7fc159a2dfbf) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/INFRA-175-shrink-gate-and-run-all-scans-back-under-their-frozen-file-size-baselines.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/INFRA-175-shrink-gate-and-run-all-scans-back-under-their-frozen-file-size-baselines.md`, whose basename is the spec's
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`

**Judged at:** HEAD `ffa7ca253320` · base `origin/develop@ffa7ca253320` · document `.agents/spec-docs/todo/INFRA-175-shrink-gate-and-run-all-scans-back-under-their-frozen-file-size-baselines.md` blob `22d1875a154f` (untracked)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-06

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-06; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/INFRA-175-shrink-gate-and-run-all-scans-back-under-their-frozen-file-size-baselines.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/INFRA-175-shrink-gate-and-run-all-scans-back-under-their-frozen-file-size-baselines.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (5)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 1041 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->

```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/INFRA-175-shrink-gate-and-run-all-scans-back-under-their-frozen-file-size-baselines.md",
  "specPath": ".agents/spec-docs/todo/INFRA-175-shrink-gate-and-run-all-scans-back-under-their-frozen-file-size-baselines.md",
  "taskItems": [
    {
      "kind": "tc-id",
      "value": "TC-01"
    },
    {
      "kind": "tc-id",
      "value": "TC-02"
    },
    {
      "kind": "tc-id",
      "value": "TC-03"
    },
    {
      "kind": "tc-id",
      "value": "TC-04"
    },
    {
      "kind": "tc-id",
      "value": "TC-05"
    }
  ],
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/spec-docs/todo/INFRA-175-shrink-gate-and-run-all-scans-back-under-their-frozen-file-size-baselines.md",
    ".agents/tasks/INFRA-175-shrink-gate-and-run-all-scans-back-under-their-frozen-file-size-baselines.md"
  ]
}
```

<!-- checkpoint-evidence:v2:end -->

**Judged at:** HEAD `caae2df542ff` · base `origin/develop@caae2df542ff` · document `.agents/spec-docs/todo/INFRA-175-shrink-gate-and-run-all-scans-back-under-their-frozen-file-size-baselines.md` blob `3785126564fb` (untracked)
