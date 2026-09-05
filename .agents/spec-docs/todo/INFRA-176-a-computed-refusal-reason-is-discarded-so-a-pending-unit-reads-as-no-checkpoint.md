---
status: approved
type: INFRA
tags: [infra]
lane: L1
---

# INFRA-176: a computed refusal reason is discarded, so a pending planning unit reads as no checkpoint at all

Paired with `.agents/tasks/INFRA-176-a-computed-refusal-reason-is-discarded-so-a-pending-unit-reads-as-no-checkpoint.md`.
Arising from [issue #2597](https://github.com/woojubb/robota/issues/2597).

## Problem

`l0GroundDecision` in `scripts/harness/plan-order-records.mjs` computes exactly why the L0 ground does
not apply to a pending unit and then throws it away:

```js
if (ground !== proven && l0GroundProblems(ground, textBefore, planSignal).length > 0) {
  return { grounded: false, problem: null };
}
```

`l0GroundProblems` returns one of three specific sentences — the unit has no Task record, the Task
records no `SCENARIO DRAFTED` verdict, or the unit carries a spec document and is therefore L1/L2. The
caller sees `problem === null` and falls through to `staged implementation has no planning checkpoint
ancestor.` The reader is then told to look for a missing checkpoint while the actual cause — measured,
named, and one line away — is discarded.

## Prior Art Research

Waived: this changes what one of this repository's own maintenance scripts prints when it refuses. No
external product documentation, protocol specification or release note bears on the wording of a local
refusal. The behaviour that must NOT change is pinned by this repository's own test suite, and § Decision
cites the exact tests.

## Architecture Review

### Affected Scope

Two harness modules: `scripts/harness/plan-order-records.mjs` (the decision) and
`scripts/harness/scan-user-execution-plan-order.mjs` (the two call sites that emit refusals). No
package, no app, no shipped surface.

### Sibling scan

The other consumers of `l0GroundDecision` were enumerated: the history walk at
`scan-user-execution-plan-order.mjs` and the staged path in the same file, and nothing else
(`git grep -n l0GroundDecision`). `isApprovedDocumentationBatch` calls `l0GroundProblems` directly and
is unaffected, because it reads only whether the list is empty.

### Alternatives Considered

1. **A1 — return the reason as `problem`, replacing the generic refusal.** Pro: one line, the reader
   sees the cause immediately. Con: MEASURED TO BREAK EIGHT NAMED TESTS. `problem` is the field the
   caller uses to REPLACE the verdict, and eight tests contract that verdict — "refuses an L1 PLAN
   entry missing the paired Task path as no checkpoint", "…missing the SCENARIO DRAFTED signal as no
   checkpoint", "…missing the draft → approved upgrade line as no checkpoint", among others. Those
   tests are right: a checkpoint that does not parse is not a checkpoint, and the verdict must stand.
   Baseline was 185 passed / 2 failed (the new RED cases); A1 made it 177 passed / 10 failed.
   REJECTED on evidence.
2. **A2 — carry the reason in a new field and append it to the existing sentence (CHOSEN).** Pro: the
   verdict is untouched, so every one of those eight tests stays green — their assertions are
   `toMatch(/no planning checkpoint ancestor/)`, a substring match that survives an appended clause.
   The reader gets the cause. Con: the message grows; a refusal now carries two sentences.
3. **A3 — leave it and document the trap in the rules.** Pro: no code change. Con: the information is
   already computed at the moment of the refusal; routing a reader to a document to re-derive what the
   program already knew is the defect, not a remedy for it. REJECTED.

### Decision

A2. `l0GroundDecision` returns `reason` alongside the unchanged `{grounded: false, problem: null}`, and
the staged-side caller appends it to the refusal it already emits. What is ACCEPTED does not change —
only what a refusal says about itself.

**Delivery mode:** `single`

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — 2 harness modules, listed in § Affected Scope
- [x] Sibling scan 완료 — every caller of `l0GroundDecision` and `l0GroundProblems` enumerated
- [x] 대안 최소 2개 검토 완료 — 3 alternatives; A1's rejection is a measured test count, not an argument
- [x] 결정 근거 문서화 완료 — § Decision, naming the field whose contract the eight tests protect

## Fallback & Degradation Declaration

No behaviour degrades: the refusal set is identical before and after, which TC-04 asserts by running
the whole owning suite. If `reason` is ever absent the message falls back to exactly today's sentence.

## Solution

Return `reason` from `l0GroundDecision` when `l0GroundProblems` is non-empty, leaving `problem` null.
Append it at the staged-side call site in `scripts/harness/scan-user-execution-plan-order.mjs`.

## Affected Files

- `scripts/harness/plan-order-records.mjs`
- `scripts/harness/scan-user-execution-plan-order.mjs`
- `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs`

## Completion Criteria

- [ ] TC-01: with a pending unit whose Task exists and which carries a spec document,
      `l0GroundDecision` returns `problem: null` AND a `reason` naming both the unit and the spec path.
      Red before the change: `reason` is undefined.
- [ ] TC-02: with no pending unit and nothing proven, the decision is still exactly
      `{ grounded: false, problem: null }` with no `reason` — the generic refusal is accurate there.
- [ ] TC-03: with a pending unit that has no Task record, the reason names the missing record rather
      than a spec document, so the causes stay distinguishable.
- [ ] TC-04: `npx vitest run scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs` passes
      in full, so the eight tests that contract the verdict are untouched.

## Test Plan

| TC-ID | Test Type | Tool / Approach                                  | Notes                                    |
| ----- | --------- | ------------------------------------------------ | ---------------------------------------- |
| TC-01 | unit      | `l0GroundDecision` with an injected `textBefore` | RED observed: `reason` undefined         |
| TC-02 | unit      | the same, with no pending unit                   | the control that keeps the change narrow |
| TC-03 | unit      | the same, pending unit with no Task record       | RED observed                             |
| TC-04 | unit      | the whole owning suite                           | 185 → 187 passed, 0 broken               |

## User Execution Test Scenarios

Not applicable.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This changes the wording of a refusal printed by one of the repository's own internal
maintenance scripts. Nothing it touches is published, installed, or reachable from any command a
person outside this repository can run — there is no screen, no CLI flag, no SDK entry point and no
file a user of Robota ever sees, so there is no surface on which a scenario could be performed.

## Tasks

`.agents/tasks/INFRA-176-a-computed-refusal-reason-is-discarded-so-a-pending-unit-reads-as-no-checkpoint.md`

## Evidence Log

### [GATE-APPROVAL] — ✅ PASS | 2026-09-06

**Status upgrade:** draft → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "이슈 빨리 좀 처리해. … 지금부터 한시간 안에 3개 이상 develop브랜치에 머지 완료 처리하세요. 완료 목표치 10개 … 이 심각한 문제를 해결할 때까지 반복하세요."
**Given:** 2026-09-06, this conversation
**Review fingerprint:** b4e12babf2f3 (review d19425d8, type/tags 2433998c)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-06, this conversation
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (b4e12babf2f3) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

**Judged at:** HEAD `4ba125f9000a` · base `origin/develop@f43a2b5dc782` · document `.agents/spec-docs/todo/INFRA-176-a-computed-refusal-reason-is-discarded-so-a-pending-unit-reads-as-no-checkpoint.md` blob `13338f8a392b` (untracked)

### [GATE-PLAN] — ✅ PASS | 2026-09-06

**Status upgrade:** draft → approved

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: INFRA` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (1 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 750 chars, 2 sentences
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: `## Prior Art Research` section present
- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — All 4 checklist items are `[x]`: 4/4 checklist items `[x]`
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: Sibling scan `[x]` with completion evidence
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: 3 numbered alternatives, each with Pro and Con
- GATE-WRITE — Decision references the trade-off that drove the choice: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — **New-surface placement (conditional):** IF the spec introduces a new package / app / presentation or interfac: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Every item has a `TC-N` prefix (TC-01, TC-02, …) — items without TC-N prefix = FAIL: 4 criteria, all `TC-NN:` prefixed
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — No criterion uses: "works correctly", "no errors", "implemented", "displays correctly": none of "works correctly", "no errors", "implemented", "displays correctly" appears
- GATE-WRITE — `## Test Plan` section present: `## Test Plan` present
- GATE-WRITE — One row exists for each TC-N in Completion Criteria (count must match): 4 Test Plan rows = 4 TC criteria
- GATE-WRITE — Each row has a non-empty Test Type and Tool/Approach (no "TBD"): 4 rows with Test Type and Tool, no TBD
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
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (b4e12babf2f3) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/INFRA-176-a-computed-refusal-reason-is-discarded-so-a-pending-unit-reads-as-no-checkpoint.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/INFRA-176-a-computed-refusal-reason-is-discarded-so-a-pending-unit-reads-as-no-checkpoint.md`, whose basename is the spec's
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`

**Judged at:** HEAD `4ba125f9000a` · base `origin/develop@f43a2b5dc782` · document `.agents/spec-docs/todo/INFRA-176-a-computed-refusal-reason-is-discarded-so-a-pending-unit-reads-as-no-checkpoint.md` blob `4c78765500ba` (untracked)
