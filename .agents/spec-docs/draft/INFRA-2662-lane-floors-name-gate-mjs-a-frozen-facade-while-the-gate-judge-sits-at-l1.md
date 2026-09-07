---
status: draft
type: INFRA
tags: [harness, governance]
lane: L2
---

# INFRA-2662: Lane floors name gate.mjs, a frozen facade, while the gate judge sits at L1

Paired with `.agents/tasks/INFRA-2662-lane-floors-name-gate-mjs-a-frozen-facade-while-the-gate-judge-sits-at-l1.md`. Arising from [issue #2662](https://github.com/woojubb/robota/issues/2662).

## Problem

`.agents/rules/spec-workflow.md` § Lane floors gives `scripts/harness/gate.mjs` an L2 floor, whose
stated reason is "The mechanical gate judge — same reason": a delegated class may not approve a change
to what delegation means.

That file decides nothing. It is 11 lines of re-export, and `scan-gate-entrypoint-stability`
(INFRA-2618) refuses every edit to it, down to one byte:

```js
export * from './gate-public-api.mjs';
export { main } from './gate-cli.mjs';
```

The mechanical gate judge is the 14 sibling modules it re-exports — `gate-operations.mjs` (~2288
lines: `runJudge`, `runApprove`, `runAdvance`, `runRecord`, and the criterion judgements),
`gate-cli.mjs`, `gate-catalogue.mjs`, `gate-document.mjs`, `gate-advance-contract.mjs`,
`gate-implementation-contract.mjs`, `gate-checkpoint-evidence*.mjs`, `gate-implement-*.mjs`,
`gate-public-api.mjs` — plus the two baselines those modules are checked against.

Reproduction, against the table as written:

```
node -e 'import("./scripts/harness/scan-lane-declaration.mjs").then(m => {
  const rule = require("fs").readFileSync(".agents/rules/spec-workflow.md","utf8");
  const l2 = m.parseLaneFloors(rule).filter(r => r.floor === "L2").map(r => m.globToRegExp(r.pattern));
  console.log(l2.some(p => p.test("scripts/harness/gate-operations.mjs")));
})'
```

prints `false`. Every one of those modules falls through to `scripts/**#non-comment` — **L1**, the lane
the `LANE-L0-L1` delegated class pre-approves.

**The L2 floor guards the one file nobody may edit, and leaves every file that decides a gate verdict
at a lane an agent approves for itself.**

It is not hypothetical. Implementing #2661 edited `runApprove`'s approval-recording logic and
`parseArgs`; `scan-lane-declaration` derived L1, correctly per this table, and the delegated class
approved it. A change to what a GATE-APPROVAL record contains took the lane the gate judge was
written to be above.

## Prior Art Research

Waived: this item changes no model — it corrects which paths an already-researched model covers. The
delegation model this floor implements was researched and recorded when it was adopted
(`.agents/rules/backlog-execution.md` § Delegated Approval Classes cites ITIL 4's pre-authorised
standard change and the AWS IAM permissions boundary, and the same section states the exclusion this
row exists to enforce). No product documentation bears on the narrower question here, which is a
factual one about this repository: which files in this tree decide a gate verdict. That question is
answered by reading the tree, and the answer is recorded in the Problem section above.

## Architecture Review

### Affected Scope

- `.agents/rules/spec-workflow.md` — the § Lane floors row
- `scripts/harness/__tests__/scan-lane-declaration.test.mjs` — the regression test

### Alternatives Considered

1. **Widen the row to a glob over the gate modules** — `scripts/harness/gate*.{mjs,json}`.
   - Pro: one row, matching all 15 gate paths and no neighbour (verified against the live
     `globToRegExp`); it keeps the table's existing shape and reads as what it means; new gate modules
     are covered the day they are added, which is exactly how this gap opened when the judge was split
     out of the facade.
   - Con: it is a floor by filename convention — a gate module that does not start with `gate` would
     escape it, and a non-judging helper that does would be pulled up.
2. **List each module as its own row.**
   - Pro: every covered path is named explicitly; no convention to rely on.
   - Con: 15 rows for one concept, and the next module added silently derives L1 — the same failure
     this item exists to close, reopened by the next split. The table is criteria a scanner reads, so
     a rule that must be re-edited to stay true is the weaker rule.

### Decision

**Alternative 1.** The trade-off is between naming paths exhaustively and naming them by the
convention the directory already follows. Exhaustive listing is more precise today and wrong tomorrow:
this gap was created by a refactor that moved judgement out of `gate.mjs` into new `gate-*.mjs`
siblings, and an exhaustive list would have been silently outrun by that same refactor. The glob is
verified to match all 15 gate paths and none of `scan-gate-entrypoint-stability.mjs`,
`scan-gate-evaluator-isolation.mjs`, `worktree-gate.mjs` or `__tests__/gate.test.mjs`, and the
regression test asserts both halves against the live rule so a future widening or narrowing is caught.

**Deliberate non-goal.** `scan-gate-evaluator-isolation` names `gate-operations.mjs` as the evaluator
and `.agents/rules/enforcement-architecture.md` names `gate.mjs`; the repository holds three
statements of "which file is the gate judge". This item corrects the one that is load-bearing for lane
derivation and leaves the other two alone rather than widening a governance change to a second and
third enforcement surface in the same diff. The disagreement is recorded in issue #2662.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — the sibling rows are the other L2 enforcement paths (`scan-lane-declaration.mjs`, `run-all-scans.mjs`, `pre-push.mjs`); this row is brought into line with them, and no new row concept is introduced
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

None

## Solution

1. `.agents/rules/spec-workflow.md` § Lane floors — replace the `scripts/harness/gate.mjs` row with
   `scripts/harness/gate*.{mjs,json}`, and say in the Why cell why the bare filename was wrong.
2. `scripts/harness/__tests__/scan-lane-declaration.test.mjs` — add a regression case against the LIVE
   rule asserting every gate module derives L2 and no neighbour is pulled up with it.

No scanner code changes: `scan-lane-declaration` already reads this table as its criteria and already
implements `{a,b}` in `globToRegExp`.

## Affected Files

- `.agents/rules/spec-workflow.md` — the § Lane floors row
- `scripts/harness/__tests__/scan-lane-declaration.test.mjs` — the regression case

## Completion Criteria

- [ ] TC-01: `pnpm exec vitest run scripts/harness/__tests__/scan-lane-declaration.test.mjs` → exits 0,
      and the new case exits 1 with the rule row reverted (the red-proof of the floor)
- [ ] TC-02: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` → exits 0
- [ ] TC-03: `pnpm exec vitest run scripts/harness/__tests__/scan-lane-declaration.test.mjs` → exits 0
      on the whole file, not only the new case
- [ ] TC-04: `node scripts/harness/scan-lane-declaration.mjs` on a diff touching
      `scripts/harness/gate-operations.mjs` with `Lane: L1` declared → exits non-zero, naming the path
      that sets the L2 floor

## Test Plan

| TC-ID | Test Type | Tool / Approach                                    | Notes                                             |
| ----- | --------- | -------------------------------------------------- | ------------------------------------------------- |
| TC-01 | Unit      | `pnpm exec vitest run` on `scan-lane-declaration.test.mjs` | RED with the rule row reverted, GREEN with it |
| TC-02 | Suite     | `run-all-scans.mjs --affected --context pr`        | Regression — the affected set, not the full suite |
| TC-03 | Unit      | `pnpm exec vitest run scan-lane-declaration.test.mjs` | The whole test file                            |
| TC-04 | CLI       | `scan-lane-declaration.mjs --changed --diff-file`  | The floor is refused end to end, not only parsed  |

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This change is a row in a repository governance rule and its regression test. It ships in
no published package and is reachable from no Robota product surface — not the SDK, the agent runtime,
any transport, the installed CLI, or the web UI — so no end user can run it or observe its effect. The
only actor it changes behaviour for is the repository's own lane scanner, whose refusal is covered by
TC-04.

## Tasks

- [ ] `.agents/tasks/INFRA-2662-lane-floors-name-gate-mjs-a-frozen-facade-while-the-gate-judge-sits-at-l1.md` — todo

## Evidence Log

### [GATE-WRITE] — 🔴 NON-COMPLIANCE | 2026-09-07

**Status remains:** draft

**Violation:** The implementation of every `## Solution` item already exists, uncommitted, in this
working tree, while this document is `status: draft` with an empty `## Evidence Log` — no
`[GATE-WRITE]` PASS is recorded, so GATE-APPROVAL, the step `spec-workflow.md` § HARD GATE: No
Immediate Implementation names as the authorization to write code ("Implement — code only after
GATE-APPROVAL passes"), has not run. `git status --porcelain` at HEAD `754c9e239eec` (identical to
`origin/develop`) shows `M .agents/rules/spec-workflow.md` and
`M scripts/harness/__tests__/scan-lane-declaration.test.mjs` — exactly this document's two
`## Affected Files` — plus the two untracked planning artifacts; neither modified path is in the
`AUTO_GENERATED_CHURN` allowlist (`scripts/harness/verification-receipt-storage.mjs:15-18`). `git diff`
confirms the tree matches the Solution verbatim: Solution 1's row replacement is already applied (the
§ Lane floors path cell now reads the glob, with a Why cell explaining that the bare filename named a
frozen facade), and Solution 2's regression case is already applied — `it('gives L2 to every gate
module, not only the frozen gate.mjs facade', …)`, whose doc comment names this item, INFRA-2662. The
document presents that work as not yet done: every TC-N is `- [ ]` and `## Tasks` reads `todo`.
`gate-catalogue.md` § GATE-IMPLEMENT states this trigger in terms — "Any implementation path was
modified or committed before this gate ran" — and the on-point precedent at this same gate is
INFRA-191's `[GATE-WRITE] — 🔴 NON-COMPLIANCE | 2026-09-06`, recorded on the same fact pattern and the
same test file.

**Required action:** Restore the state GATE-WRITE expects — no staged, unstaged, untracked, renamed or
deleted path outside the paired spec/Task planning artifacts — and re-run GATE-WRITE against it; or
record in this document an explicit, owner-approved out-of-order recovery authority quoting the
approval verbatim (precedent:
`.agents/spec-docs/done/PROC-034-batch-execution-gates-at-work-unit-boundaries.md`). The verdict is
procedural: no GATE-WRITE criterion is unmet, so it requires no content change to this document.

**Mechanical criteria (20).** Re-checked against the document text rather than taken from the reported
summary; all 20 PASS, matching `gate.mjs`'s report of 27 criteria — 20 PASS, 0 FAIL, 7
PENDING-GUARDIAN.

- Frontmatter (4): `---` opens line 1; `status: draft`; `type: INFRA`, one value from the 11-prefix
  list; `tags: [harness, governance]` present.
- Problem (1): no "TBD"/"TODO" in the section — the only `todo` in the file is the `## Tasks` status
  placeholder (line 161); the section is five paragraphs plus a runnable reproduction, not a vague
  single sentence.
- Prior Art Research (3): `## Prior Art Research` present (line 53). It carries no documentation
  citation and no "no comparable reference was found" statement, so the substantiation criterion is
  met only through its OR-alternative — the explicit `Waived:` line at line 55, carrying a reason, which
  is how `scan-spec-research.mjs:74` reads the section. The waiver's substance is judged below.
- Architecture Review (3): all four checklist items `[x]` (lines 103-106) plus the fifth new-surface
  line; the Sibling scan item is `[x]` with evidence naming the sibling L2 rows — `scan-lane-declaration.mjs`,
  `run-all-scans.mjs`, `pre-push.mjs`, all three verified present as L2 rows in § Lane floors;
  Alternatives Considered has two entries, each with a Pro and a Con.
- Completion Criteria (2): TC-01…TC-04 all carry the TC-N prefix; none of "works correctly", "no
  errors", "implemented", "displays correctly" appears in any criterion (grep, 0 hits).
- Test Plan (4): section present; 4 rows for 4 TC-N (counts match); every row has a non-empty Test Type
  (Unit/Suite/Unit/CLI) and Tool/Approach, none "TBD"; no row's Tool is "manual", so the manual-Notes
  criterion is N/A — and all four rows carry Notes regardless.
- Structure (3): `## Tasks` present with the paired Task path and a `todo` placeholder; `## Evidence
  Log` present and empty at the moment of judgement; no `## Status` or `## Classification` heading in
  the body.

**Semantic criteria (7), judged fresh against the document text:**

- Problem contains a concrete symptom (`semantic`): PASS. The section names the exact row and its
  stated reason, shows the facade's two re-export lines (verified: `scripts/harness/gate.mjs` is 11
  lines and exports only `./gate-public-api.mjs` and `main` from `./gate-cli.mjs`), and states the
  wrong behaviour — every module that decides a verdict falls through to `scripts/**#non-comment`,
  L1. Verified by re-running the document's own snippet against the rule text as written
  (`git show HEAD:.agents/rules/spec-workflow.md`): `gate-operations.mjs` is covered by no L2 row —
  `false`. The named instance is real: commit `a3055924ba` (HARNESS-2661) edits `runApprove` and
  `parseArgs` in `gate-operations.mjs`, and its plan commit `2876f4d957` declares `Lane: L1`.
- Problem contains a reproduction condition (`semantic`): PASS. The `node -e` block states when and
  where — against § Lane floors as written, for any `scripts/harness/gate-*.mjs` path — with the
  expected output (`false`), reproduced above. Noted: because the fix is already applied in this tree,
  the snippet as literally written (reading the working-tree rule) now prints `true`; it reproduces
  only against HEAD's rule text. That is a consequence of the Violation above, not of the wording.
- Research findings feed `Alternatives Considered` / `Decision` (`semantic`): PASS — research waived,
  and the waiver holds on its stated reason. Its predicates were checked, not accepted: `.agents/rules/backlog-execution.md`
  § Delegated Approval Classes does cite ITIL 4's pre-authorised standard change and the AWS IAM
  permissions boundary ("defines the maximum permissions … but does not grant permissions"), and the
  same section states the exclusion this row enforces ("A delegated class may not be used to approve a
  change to what delegation means"). The claim "this item changes no model" holds: no new delegation
  concept, gate, lane or evidence form is introduced — one path pattern is widened so the existing
  model reaches the paths it always meant. The residual question is factual about this tree (which
  files decide a gate verdict), and it is answered in the Problem section and independently confirmed
  here. `research.md` permits an agent-proposed waiver where research is genuinely unnecessary; the
  choice between glob and enumeration is bounded by this repository's own `globToRegExp` and by a local
  refactor, which no external product document could overturn. Decisive for this criterion: the waiver
  leaves the Decision evidenced, not asserted — its load-bearing claim was verifiable and verified.
- Decision references the trade-off that drove the choice (`semantic`): PASS. It names the trade-off
  ("between naming paths exhaustively and naming them by the convention the directory already
  follows"), states why the convention wins here (an exhaustive list "would have been silently outrun"
  by the refactor that created this gap), and carries the cost in Alternative 1's Con. The load-bearing
  claim was verified against the live `globToRegExp`: the glob matches all 15 `scripts/harness/gate*`
  paths and none of `scan-gate-entrypoint-stability.mjs`, `scan-gate-evaluator-isolation.mjs`,
  `worktree-gate.mjs`, `__tests__/gate.test.mjs`. The "Deliberate non-goal" paragraph is accurate and
  its scoping is defensible: `scan-gate-evaluator-isolation.mjs:24` does name `gate-operations.mjs` and
  `.agents/rules/enforcement-architecture.md:227` does name `gate.mjs`, and neither contradicts the new
  row — the isolation scan's prefix list is a subset of the glob, and the rule's prose names the
  entrypoint and then generalises ("and scans that implement gate criteria"). What is left is a
  difference of precision, disclosed here, not a rule made incoherent.
- New-surface placement (conditional) (`semantic`): PASS — N/A, correctly determined. No new package,
  app, presentation or interface surface and no layer or product-family reclassification: the Affected
  Scope is one existing table row in an existing rule and one existing test file, which the working-tree
  diff confirms. The checklist records the N/A with that reason rather than leaving it silent.
- At least 1 criterion per distinct feature or sub-item (`semantic`): PASS. Two Solution sub-items:
  TC-01 covers the regression case and, through its red-proof with the row reverted, binds the rule row
  that makes it green; TC-04 observes the rule row end to end (a diff touching `gate-operations.mjs`
  declared `Lane: L1` is refused, naming the path that sets the floor). TC-03 and TC-02 add whole-file
  and affected-suite regression. Solution's third statement ("No scanner code changes") is a
  no-change claim exercised by TC-02/TC-04; the Why-cell wording is prose inside sub-item 1's row edit,
  not separately observable, and carries no TC of its own.
- Each criterion uses Command form or Observable behavior form (`semantic`): PASS. All four are command
  form with an exit-code observable: TC-01 `pnpm exec vitest run … → exits 0` plus "the new case exits 1
  with the rule row reverted"; TC-02 `run-all-scans.mjs … → exits 0`; TC-03 the same command "on the
  whole file, not only the new case"; TC-04 `scan-lane-declaration.mjs … → exits non-zero, naming the
  path that sets the L2 floor". No vague language.

**Recorded, not criterion failures:** (i) the Problem's "14 sibling modules it re-exports … plus the
two baselines" overcounts — the tree holds 12 sibling `.mjs` modules and 2 JSON baselines, 15 `gate*`
paths including `gate.mjs`; the Decision's "all 15 gate paths" is exact. (ii) "The disagreement is
recorded in issue #2662" is two-thirds true: `gh issue view 2662` records "two different answers"
(§ Lane floors versus `scan-gate-evaluator-isolation`) and does not name
`.agents/rules/enforcement-architecture.md`; this document is the only record of the third.
(iii) Alternative 1's Con is instantiated today, not hypothetical: `gate-operations.mjs` imports
criterion logic from non-`gate*` modules (`scan-spec-research.mjs` decides the research criterion,
`checkpoint-evidence-contract.mjs` the checkpoint one), which the chosen glob leaves at L1. The Con
names that class honestly; it does not defeat the criterion.

**Ordering check:** GATE-WRITE is the entry gate — no predecessor in `gate-catalogue.md` § Prior-gate
map, exempt by construction — and the document's `status: draft` in `.agents/spec-docs/draft/` matches
this gate's expected input state. This run's finding is the Violation above, not an ordering failure.

**Judged by:** backlog-gate-guard (all 27 criteria; the semantic set judged in this run, the mechanical
set re-checked against the document text rather than taken from the reported summary)
**Judged at:** HEAD `754c9e239eec` · base `origin/develop@754c9e239eec` · document `.agents/spec-docs/draft/INFRA-2662-lane-floors-name-gate-mjs-a-frozen-facade-while-the-gate-judge-sits-at-l1.md` blob `b1add11630a1` (untracked)
