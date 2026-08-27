---
status: approved
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

**Waived:** the defect and its remedy are both stated by this repository's own
`.agents/rules/measurement-provenance.md` and by the applied-check mutation discipline already used
in `scan-rule-statement-floor` and in this guard's own M1–M8 record. No external documentation source
would add to a rule the repository already owns; consulting one would be ceremony. The one external
idea that applies — mutation testing's competent-programmer premise, that a test suite is measured by
the faults it kills rather than by its own green — is already the acceptance test named below.

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
