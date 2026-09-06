---
status: approved
type: INFRA
tags: [infra]
lane: L1
---

# INFRA-177: the gate-evaluator isolation unit is a commit, not a branch range

Paired with `.agents/tasks/INFRA-177-the-gate-evaluator-isolation-unit-is-a-commit-not-a-branch-range.md`.
Arising from [issue #2610](https://github.com/woojubb/robota/issues/2610).

## Problem

`scripts/harness/scan-gate-evaluator-isolation.mjs` states its own rule as: refuses a change that
edits a gate evaluator "and records evaluated gate evidence in the same diff". It then reads the diff
as `${base}...HEAD` — the whole branch range, which is a SERIES of diffs, not one.

The consequence is total. Every item's planning checkpoint is a spec document, so it is gate evidence.
`scripts/harness/scan-user-execution-plan-order.mjs` requires that checkpoint to be an ancestor of the
implementation INSIDE the branch's own range. So an evaluator change and a checkpoint always share the
range, and the scan always refuses. Measured, all three possible shapes:

- code and checkpoint on one branch: `gate evaluator change(s) scripts/harness/gate.mjs share a diff
with gate evidence …`;
- checkpoint merged first, code on a fresh branch: `staged implementation has no planning checkpoint
ancestor` — the checkpoint is at the merge base, not after it;
- the documented remedy for that, a continuation checkpoint: `continuation requires
\`Delivery mode: sequenced\``, and declaring `sequenced`then gives`prior v2 delivery does not bind
  the current Decision contract`, whose repair needs a status the document has already left.

`scripts/harness/gate.mjs` and everything under `.claude/hooks/` therefore cannot be changed at all.
Four open issues sit behind this today: issues #2596, #2588, #2582 and #2580.

## Prior Art Research

Waived: the rule is this repository's own, its statement lives in the scan's header, and the question
is what "the same diff" denotes in that sentence. No external documentation bears on it.

## Architecture Review

### Affected Scope

One harness module and its test file. No package, no app, no shipped surface, no other scan.

### Sibling scan

`git grep -n evaluatorIsolationFindings` finds the scan and its own test and nothing else, so the pure
predicate has no other consumer to keep in step. The other scans that read a branch range —
`scan-user-execution-plan-order` and `scan-lane-declaration` — are unaffected: this changes only how
this one groups paths before applying its own unchanged predicate.

### Alternatives Considered

1. **A1 — exempt planning-gate evidence by entry kind**, permitting a diff whose spec changes add only
   `[GATE-PLAN]`/`[GATE-IMPLEMENT]` entries. Pro: keeps the range reading. Con: it makes the scan parse
   gate entries, so a rename or a new gate name silently widens the exemption, and "which gates count
   as evaluated" becomes a second thing to keep in step with the catalogue. REJECTED as a wider
   surface than the defect.
2. **A2 — judge each commit's own diff (CHOSEN).** Pro: it is what the scan's sentence already says; a
   verdict recorded in an ancestor commit was authored before the evaluator change existed, so it
   cannot be self-authored — the property is preserved exactly rather than approximated. The shape the
   rule exists for, one commit carrying both, stays refused. Con: a branch can now interleave an
   evaluator commit and a later checkpoint commit for a DIFFERENT item; that is a real narrowing and is
   stated here rather than hidden.
3. **A3 — leave it and change `scan-user-execution-plan-order` instead**, so a checkpoint at the merge
   base counts. Pro: also unblocks. Con: it weakens the ancestor requirement for EVERY item to fix a
   problem two evaluators create together, and the checkpoint rule is the one with the stronger reason
   to stay strict. REJECTED.

### Decision

A2. This is a NARROWING of a guard, and the owner may reject it: the argument is that the guard's own
sentence says "diff", the range reading is broader than the sentence, and the broader reading makes the
guard's own documented remedy unreachable — which `AGENTS.md` calls a check that fires on correct work,
whose answer is to change the check.

**Delivery mode:** `single`

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — one module and its test, listed in § Affected Files
- [x] Sibling scan 완료 — every consumer of the predicate enumerated; the two other range-reading scans checked
- [x] 대안 최소 2개 검토 완료 — 3 alternatives with pro/con, and the measured refusals that reject A3's premise
- [x] 결정 근거 문서화 완료 — § Decision, stating plainly that this narrows a guard and why

## Fallback & Degradation Declaration

A run with no commits of its own — a staged or working-tree check — keeps the range reading, so a
pre-commit invocation still has something to judge and cannot pass by having nothing to look at.

## Solution

Enumerate `base..HEAD` and judge each commit's own `--name-only` diff with the unchanged predicate.
Prefix the finding with the commit so the reader knows which one to split. Fall back to the range diff
when the branch adds no commits.

## Affected Files

- `scripts/harness/scan-gate-evaluator-isolation.mjs`
- `scripts/harness/__tests__/scan-gate-evaluator-isolation.test.mjs`

## Completion Criteria

- [ ] TC-01: a single commit carrying both an evaluator path and a spec-doc path is still one finding.
- [ ] TC-02: a checkpoint commit followed by an evaluator commit produces no finding. Red before.
- [ ] TC-03: the finding names the commit.
- [ ] TC-04: a merge commit that itself carries both is still refused.
- [ ] TC-05: the owning suite passes in full, including its two pre-existing cases.

## Test Plan

| TC-ID | Test Type | Tool / Approach                                 | Notes                          |
| ----- | --------- | ----------------------------------------------- | ------------------------------ |
| TC-01 | unit      | `commitIsolationFindings` with one mixed commit | the anti-weakening case        |
| TC-02 | unit      | checkpoint commit then evaluator commit         | RED observed before the change |
| TC-03 | unit      | assert the commit id in the finding detail      | RED observed                   |
| TC-04 | unit      | a merge commit carrying both                    | the second anti-weakening case |
| TC-05 | unit      | the owning suite                                | 2 to 6 passed, none broken     |

## User Execution Test Scenarios

Not applicable.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This changes which commits one of the repository's own internal maintenance scripts
refuses. Nothing it touches is published, installed, or reachable from any command a person outside
this repository can run — there is no screen, no CLI flag, no SDK entry point and no file a user of
Robota ever sees, so there is no surface on which a scenario could be performed.

## Tasks

`.agents/tasks/INFRA-177-the-gate-evaluator-isolation-unit-is-a-commit-not-a-branch-range.md`

## Evidence Log

### [GATE-APPROVAL] — ✅ PASS | 2026-09-06

**Status upgrade:** draft → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "이 심각한 문제를 해결할 때까지 반복하세요. 지금부터 한시간 안에 3개 이상 develop브랜치에 머지 완료 처리하세요. 완료 목표치 10개"
**Given:** 2026-09-06, this conversation
**Review fingerprint:** 6515d2c6d6d6 (review 7ad344b9, type/tags 2433998c)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-06, this conversation
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (6515d2c6d6d6) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

**Judged at:** HEAD `73d939482d1c` · base `origin/develop@73d939482d1c` · document `.agents/spec-docs/todo/INFRA-177-the-gate-evaluator-isolation-unit-is-a-commit-not-a-branch-range.md` blob `9ebc505ad230` (untracked)

### [GATE-PLAN] — ✅ PASS | 2026-09-06

**Status upgrade:** draft → approved

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: INFRA` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (1 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 1403 chars, 9 sentences
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
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (6515d2c6d6d6) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/INFRA-177-the-gate-evaluator-isolation-unit-is-a-commit-not-a-branch-range.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/INFRA-177-the-gate-evaluator-isolation-unit-is-a-commit-not-a-branch-range.md`, whose basename is the spec's
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`

**Judged at:** HEAD `73d939482d1c` · base `origin/develop@73d939482d1c` · document `.agents/spec-docs/todo/INFRA-177-the-gate-evaluator-isolation-unit-is-a-commit-not-a-branch-range.md` blob `5af4bdbbb6ee` (untracked)
