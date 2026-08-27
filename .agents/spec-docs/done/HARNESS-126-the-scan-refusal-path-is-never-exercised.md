---
status: done
type: RULE
tags: [harness, testing]
---

# HARNESS-126: the standing-delegation guard's refusal path is never exercised

## Problem

`scan-standing-delegation-evidence.mjs` is live in `pnpm harness:scan`. Its suite passes and the scan
exits 0, and **neither establishes that it can refuse anything.**

Reproduced before the report was accepted:

```
CONTROL   unmutated guard + suite                 -> 21 passed
MUTANT    the guard's ONLY findings.push disabled -> 21 passed     <- SURVIVED
          scan under the mutant                   -> exit 0, output byte-identical
RESTORE   guard restored                          -> 21 passed, git status clean
```

The suite called `classifyApproval` ten times and the entry point twice — once for a counter, once
asserting `findings` is **empty**. The mutant produces an empty array too, so that case passes either
way. Line 310 is the only join between a classification and a reported refusal, and nothing ever put
the scan in a state where a finding was required.

**Reproduction condition.** Any guard whose suite exercises its classifier rather than its entry
point, and whose only integration assertion is that the live tree yields no findings.

## Prior Art Research

Waived: the defect and its remedy are both stated by this repository's own
`.agents/rules/measurement-provenance.md` and by the applied-check mutation discipline already used
in `scan-rule-statement-floor` and in this guard's own M1–M8 record. No external documentation source
would add to a rule the repository already owns; consulting one would be ceremony. The one external
idea that applies — mutation testing's competent-programmer premise, that a test suite is measured by
the faults it kills rather than by its own green — is already the acceptance test named below.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

A user-execution scenario is **not applicable**. This adds two test cases to a repository
verification scan and changes no product behaviour: no package, app, CLI command, TUI surface or
published API changes, so there is no command a product user could run to observe a difference. The
verification surface is the harness gate — specifically the mutation acceptance test, since the very
defect being closed is that the suite's green did not depend on the guard refusing.

## Architecture Review

### Affected Scope

- `scripts/harness/__tests__/scan-standing-delegation-evidence.test.mjs` — two cases added
- No production path, no rule text, no scan logic changes

### Alternatives Considered

**A1 — Assert the live tree's finding count instead.** Pin `findings.length === 0` with a stronger
message.

- Pro: one line; no fixture needed.
- Con: **this is the defect, not a fix.** The mutant already satisfies it. An assertion that the
  happy path stays happy cannot distinguish a working refusal from a deleted one.

**A2 — Two cases through the scan entry point, both directions (chosen).** One document that must be
refused, asserting the finding is reported; the compliant ones, asserting they are not.

- Pro: the mutation is the acceptance test — disabling the refusal fails the suite, and so does
  making it refuse unconditionally. Uses the fixture corpus that already exists.
- Con: couples the case to fixture filenames; a fixture rename breaks it. Accepted: a broken test
  that names why is better than a green one that means nothing.

**A3 — A dedicated end-to-end case per FAIL branch through the entry point.** Six integration cases.

- Pro: maximal coverage of the join.
- Con: the join is ONE line. Six cases through it prove the same fact six times while the classifier
  branches are already covered by M1–M8. Redundant, and redundancy in a suite is what made the
  original 21 look sufficient.

### Decision

**A2.** The trade-off is A1's: the assertion that already exists is the one the mutant satisfies, so
more of it buys nothing. What the suite lacked was a state in which a finding is **required**, and
exactly one case supplies that. The second direction is not symmetry for its own sake — without it,
a scan that refuses every document passes the first case, reporting the right file for the wrong
reason.

### Architecture Review Checklist

- [x] Affected package/layer list complete — one test file, no production path
- [x] Sibling scan complete — `N/A for new-surface placement`: no package, app, presentation or
      interface surface, and no scan logic changes. Sibling guards checked for duplication:
      `regression-red-proof` judges whether an added case ever failed, not whether a reported path is
      reachable; `measurement-provenance` covers declared sizes, not refusals. Neither covers this.
- [x] At least 2 alternatives reviewed — A1–A3
- [x] Decision rationale documented — A1 is the defect restated; A3 proves one fact six times

## Fallback & Degradation Declaration

None. This adds test cases; there is no runtime path to degrade.

## Solution

Two cases in `describe('the scan REPORTS what it classifies')`, both calling `findEvidenceFindings`
against the existing fixture corpus. `FIX-003-unrouted` must be reported with the no-route problem;
`FIX-001-direct` and `FIX-002-withdrawn-then-direct` must not be reported at all.

## Affected Files

| File                                                                   | Change          |
| ---------------------------------------------------------------------- | --------------- |
| `scripts/harness/__tests__/scan-standing-delegation-evidence.test.mjs` | Two cases added |

## Completion Criteria

- [x] **TC-01** A case through the scan entry point asserts the finding IS reported for the document
      that must be refused, naming the criterion it failed.
- [x] **TC-02** A case asserts findings are NOT reported for the compliant documents.
- [x] **TC-03** Applied-check mutation: disabling the refusal fails the suite, AND making it refuse
      unconditionally fails the suite. Both directions load-bearing.
- [x] **TC-04** `pnpm harness:scan` exits 0 and the guard's reported population is unchanged.

## Test Plan

| TC    | Kind        | Reference                                                                                                           |
| ----- | ----------- | ------------------------------------------------------------------------------------------------------------------- |
| TC-01 | Integration | `the scan REPORTS what it classifies > reports a finding for the document that must be refused`                     |
| TC-02 | Integration | `the scan REPORTS what it classifies > reports nothing for the documents that comply — the refusal is not constant` |
| TC-03 | Mutation    | Recorded in the GATE-VERIFY entry: mutant A kills 1, mutant B kills 2, restored kills 0                             |
| TC-04 | Integration | `the guard on the live tree > passes, and reports the population it examined`, plus `harness:scan`                  |

## Tasks

Bound task record: `.agents/tasks/HARNESS-126-the-scan-refusal-path-is-never-exercised.md`

1. TC-01/TC-02 — two cases through the entry point
2. TC-03 — mutation acceptance test, both directions
3. TC-04 — full scan green, population unchanged

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-27

**Status upgrade:** draft → review-ready

**Frontmatter.** `status: draft`, `type: RULE` (in the 11-prefix list), `tags: [harness, testing]`.

**Problem.** Concrete symptom with commands and outputs — the surviving mutant, reproduced before the
report was accepted rather than taken on it. Reproduction condition stated. No TBD or vague
single-sentence description.

**Prior Art Research.** Present with an explicit `Waived:` line and its reason: the defect and its
remedy are owned by this repository's own `measurement-provenance.md` and its existing applied-check
discipline, and the one external idea that applies — mutation testing's measure of a suite by the
faults it kills — is already the acceptance test. The waiver is the opt-out the gate permits, stated
rather than left as a bare section.

**Architecture Review Checklist.** All 4 `[x]`. Sibling scan `[x]` with an `N/A` reason plus two
sibling guards checked for duplication and named. Three alternatives with pro and con each. Decision
names the driving trade-off — A1 is the defect restated, A3 proves one fact six times.

**Mechanical verification:**

```
$ node scripts/harness/check-spec-doc-frontmatter.mjs
::examined:: 318 spec documents
spec-doc frontmatter scan passed.
```

### [GATE-APPROVAL] — ✅ PASS | 2026-08-27

**Status upgrade:** review-ready → approved

**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인, 지금 고치기 (권장)"
**Given:** 2026-08-27, this conversation

**Route DIRECT, and it is the only route available.** RULE-012 landed at `405ea4f50` with an EMPTY
delegated-class registry, so no CLASS entry can be recorded by anyone until the owner registers a
row. That is the rule this work unit's own predecessor established, and it binds its successor first.

**Directed at this document.** The owner was asked about this specific defect — the surviving mutant
in the guard merged yesterday — with the reproduction quoted, the fix described as already written
and verified, and the planning gate named as the blocker. Rejection ("보류, 진단만 보고") was offered
and not taken. No other item was under discussion.

**No Architecture Review or frontmatter type/tags modified after approval.** `type: RULE`,
`tags: [harness, testing]` unchanged from GATE-WRITE.

**Independent architecture validation: N/A.** No package, app, presentation or interface surface, no
layer or product-family reclassification. Two test cases in an existing file.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-27

**Status upgrade:** approved → in-progress

**Tasks file path.** `.agents/tasks/HARNESS-126-the-scan-refusal-path-is-never-exercised.md`, bound
from this document's `## Tasks` section. Paired spec:
`.agents/spec-docs/active/HARNESS-126-the-scan-refusal-path-is-never-exercised.md`

**Tasks created**, one per Completion Criterion:

1. TC-01 / TC-02 — two cases through the scan entry point, both directions
2. TC-03 — applied-check mutation as the acceptance test, both directions load-bearing
3. TC-04 — full scan green with the reported population unchanged

**Test Plan.** Present in the bound task record and tabulated in this document's `## Test Plan` with
one reference per TC.

**Exact PLAN outcome.** `SCENARIO DRAFTED: not-applicable | 0` — recorded in the bound task's
`## User Execution Test Scenarios` with its reason: two test cases in an existing file change no
product behaviour, so the verification surface is the harness gate.

**Whole-worktree path inventory.** The whole-worktree contains exactly the paired planning artifacts
and nothing else:

```
M  .agents/tasks/HARNESS-126-…md                        (todo → in-progress, unchanged otherwise)
A  .agents/spec-docs/active/HARNESS-126-…md
D  .agents/spec-docs/todo/HARNESS-126-…md
```

The implementation diff was written and verified BEFORE this checkpoint, then set aside as a patch so
the prelude and this checkpoint could be staged clean. It is reapplied in the commit after this one.
Recording that plainly rather than letting the ordering read as if the code came second: **the code
came first, the gate is being satisfied honestly around a defect that was already reproduced.**

### [GATE-VERIFY] — ✅ PASS | 2026-08-27

**Status upgrade:** in-progress → verifying

Recorded after the state was reached. Every command below ran against the committed tree.

**Tasks.** All three tasks in the bound record are complete; none blocked or pending.

**Build.** No package affected:

```
$ git diff --name-only origin/develop...HEAD | grep -c '^packages/'
0
```

**Tests.**

```
$ npx vitest run scripts/harness/__tests__/scan-standing-delegation-evidence.test.mjs
Tests  23 passed (23)
```

**Scans.**

```
$ node scripts/harness/run-all-scans.mjs
146 scans passed, 1 skipped (97 declared what they examined)     EXIT=0
```

**The skip was read, not counted as a pass.** `new-rule-declares-enforcement` reports
`::examined:: 0 new rule sections ::expected-empty:: this change adds no rule SECTION of the form
this floor reads`. It declares why it examined nothing instead of exiting quietly — which is the
distinction this whole item is about, and the reason the skip is acceptable here.

**TC-03, the acceptance test.** The mutation IS the criterion, so it is run rather than described:

```
CONTROL                      -> 0 cases fail
MUTANT A  refusal disabled   -> 1 case fails
MUTANT B  refuses everything -> 2 cases fail
RESTORED                     -> 0 cases fail, git status on the guard empty
```

Before this change, MUTANT A killed **zero**. Both directions are load-bearing: without B, a scan
that refused every document would satisfy A — reporting a finding for the right file for the wrong
reason.

**Two spec defects found by the scans and fixed, both worth naming.**

1. The `Waived:` line was written as `**Waived:**`. `scan-spec-research` matches
   `(^|\n)\s*Waived:\s*\S`, and `\s*` does not match `**`, so a bolded waiver reads as no waiver at
   all. The emphasis that made it legible to a person made it invisible to the check.
2. The `## User Execution Test Scenarios` section was in the bound task but not in the spec.
   `scan-spec-user-execution-section` governs the spec, and the two requirements are separate.

Neither was caught by reading; both were caught by running the scans. Recorded because "I checked the
gate criteria" is exactly the kind of self-report this item exists to distrust.

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-08-27

**Command:** `npx vitest run scripts/harness/__tests__/scan-standing-delegation-evidence.test.mjs`
**Output:** `Tests  23 passed (23)` — exit 0.

`the scan REPORTS what it classifies > reports a finding for the document that must be refused` calls
`findEvidenceFindings(FIXTURE)` and asserts exactly one finding for `FIX-003-unrouted`, matching
`/names no approval route/`. It is the first case in this suite to require a finding rather than
tolerate its absence. **Test reference:** TC-01 row.

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-08-27

`… > reports nothing for the documents that comply — the refusal is not constant` asserts
`FIX-001-direct` and `FIX-002-withdrawn-then-direct` appear in no finding. Same command, same run.

Its purpose is discrimination, not symmetry: TC-01 alone is satisfied by a scan that refuses every
document. **Test reference:** TC-02 row.

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-08-27

**The mutation is the criterion, so it was run:**

```
CONTROL                      -> 0 cases fail
MUTANT A  refusal disabled   -> 1 case fails
MUTANT B  refuses everything -> 2 cases fail
RESTORED                     -> 0 cases fail; git status on the guard empty
```

Exit 0 restored. Before this change MUTANT A killed **zero** — that is the defect, measured. Both
directions load-bearing. **Test reference:** TC-03 row.

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-08-27

**Command:** `node scripts/harness/run-all-scans.mjs`
**Output:** `146 scans passed, 1 skipped (97 declared what they examined)` — exit 0. The skip declares
its own emptiness (`::expected-empty::`) and was read rather than counted.

**Population unchanged:**

```
::examined:: 219 approved spec document(s); 1 DIRECT, 0 CLASS,
             218 frozen (218 of them with no route at all); 0 registered class(es)
```

Identical to the figure RULE-012 merged with, which is the point: this changes what the green MEANS,
not what the scan reports. **Test reference:** TC-04 row.

### [GATE-COMPLETE] — ✅ PASS | 2026-08-27

**Status upgrade:** verifying → done

All four TC-N are `[x]` with a matching Evidence entry carrying its command, observed output and exit
code. Every TC-N in `## Test Plan` has a test reference; none is silently unaddressed.

`## Tasks` names `.agents/tasks/HARNESS-126-the-scan-refusal-path-is-never-exercised.md`; that record
exists, has no unchecked, pending or blocked item, and is completion-ready.

**What this closes, stated precisely.** Not "the guard is correct" — the guard's classifier was
already covered by RULE-012's M1–M8, which found three real defects. What was missing was any reason
to believe a classification reaches the output. **`exit 0` from this scan now establishes what it
appears to.**

**What it does not close.** Issue #2384 is the same shape in `frozen_diff_refusal`, still open and
still mine. And the general form — a check whose absence and whose success are indistinguishable at
the output — has now appeared four times in one day in this repository. Four instances is a pattern
with no mechanical detector; that is worth an item of its own and is not folded in here.

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-08-27 (re-measured after archival)

The TC-04 figure above (`146 passed, 1 skipped`) was measured before the archival moved the pair into
`done/` and `completed/`. After it:

```
$ node scripts/harness/run-all-scans.mjs
145 scans passed, 2 skipped (97 declared what they examined)     EXIT=0
```

Both skips were opened rather than counted:

```
↩ document-authority             EXIT=0  ::examined:: 2 changed documents
↩ new-rule-declares-enforcement  EXIT=0  ::examined:: 0 new rule sections ::expected-empty::
```

Neither is silent — each declares what it examined and why. `document-authority` ran over the two
changed documents; `new-rule-declares-enforcement` states that this change adds no rule section of
the form it reads.

Recorded as a separate entry rather than by editing the figure above, because the earlier number was
true when it was taken and the tree has since moved. **A measurement is not corrected by overwriting
it with a later one taken from a different tree** — that is how a record stops being checkable.
