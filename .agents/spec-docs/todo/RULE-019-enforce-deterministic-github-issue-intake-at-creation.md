---
status: approved
type: RULE
tags: [rule]
lane: L1
---

# RULE-019: Enforce deterministic GitHub Issue intake at creation

Paired with `.agents/tasks/RULE-019-enforce-deterministic-github-issue-intake-at-creation.md`. Arising from [issue #2476](https://github.com/woojubb/robota/issues/2476).

## Problem

New Issue Forms already apply one work-kind label and `status:needs-triage`, but blank Issues and
manual/API paths can bypass that contract. A newly created Issue can therefore enter the repository
without exactly one kind, without the intake marker, or with a guessed P label, and the next triager
must repair the record before it can enter the queue.

Reproduction: open the repository's new-Issue chooser or create an Issue through an API path. Before this
change, the chooser permits a blank Issue and the written procedure does not require the manual/API path
to reproduce the form labels and evidence contract.

<!-- Symptom + reproduction condition: the command, the output that is wrong, and when it occurs.
     Replace the seed above if it does not name both. -->

## Prior Art Research

Waived: internal fix with no contract change; the remedy is the repository's own precedent

## Architecture Review

### Affected Scope

- `.github/ISSUE_TEMPLATE/config.yml`
- `.agents/skills/github-issue-triage/SKILL.md`
- `.agents/skills/find-to-issue/SKILL.md`
- `.agents/skills/index.md`

### Alternatives Considered

1. Document the rule only in `github-issue-triage`.
   - Pro: smallest documentation change.
   - Con: `find-to-issue` and GitHub's chooser could still bypass the contract.
2. Enforce the entry point mechanically and route every other creation path to the same contract.
   - Pro: blank Issues are refused, Forms supply the labels, and agent/manual/API paths have one SSOT.
   - Con: callers using an unavoidable API path must perform one additional audit and may need to repair
     malformed metadata before publication.

### Decision

**Alternative 2.** The issue is an intake-path class, so the smallest reliable fix must cover the
mechanical chooser and every documented bypass without introducing a second priority or status system.
This is documentation/configuration only and remains below the L2 policy-file floor.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: internal fix with no contract change; the remedy is the repository's own precedent
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

None

## Solution

Disable blank Issues, retain the exact three form label pairs, and state the same creation contract in the
two skills that can file Issues. Manual/API creation remains supported but must reproduce the form labels,
evidence fields, and post-create audit; priority is still assigned only during triage.

## Affected Files

- `.github/ISSUE_TEMPLATE/config.yml`
- `.agents/skills/github-issue-triage/SKILL.md`
- `.agents/skills/find-to-issue/SKILL.md`
- `.agents/skills/index.md`

## Completion Criteria

- [ ] TC-01: `test "$(yq '.blank_issues_enabled' .github/ISSUE_TEMPLATE/config.yml)" = false` and each
      Issue Form declares exactly its kind plus `status:needs-triage` → exits 0.
- [ ] TC-02: `node scripts/harness/scan-github-label-registry.mjs` → exits 0 and reports all declared
      form/protected-consumer relations examined.
- [ ] TC-03: `node scripts/harness/github-issue-triage.mjs audit --repo woojubb/robota` → exits 0 with
      `malformed: 0` for the current open Issue population.
- [ ] TC-04: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts`
      → exits 0.

## Test Plan

| TC-ID | Test Type         | Tool / Approach                             | Notes                                                         |
| ----- | ----------------- | ------------------------------------------- | ------------------------------------------------------------- |
| TC-01 | Config/contract   | `yq` plus `rg` over the three forms         | Verifies blank chooser is disabled and form labels are exact. |
| TC-02 | Harness scan      | `scan-github-label-registry.mjs`            | Checks registry, forms, and protected consumers.              |
| TC-03 | Integration audit | `github-issue-triage.mjs audit`             | Read-only live population check; no Issue mutation.           |
| TC-04 | Harness scan      | `run-all-scans.mjs --affected --context pr` | Affected scans for the documentation/configuration diff.      |

## User Execution Test Scenarios

Not applicable — no runnable user-facing behaviour changes; verification evidence is recorded in the engineering test plan (TC-01 to TC-03).

Recorded as the rule's required choice rather than skipped.

## Tasks

- [ ] `.agents/tasks/RULE-019-enforce-deterministic-github-issue-intake-at-creation.md` — todo

## Evidence Log

### [GATE-APPROVAL] — ✅ PASS | 2026-08-29

**Status upgrade:** draft → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "앞으로 누가 깃헙 이슈를 추가할 때 너와 동일한 기준을 가지고 추가하게 하려면 이 것을 규칙이 담긴 스킬로 강제해야 할것 같습니다."
**Given:** 2026-08-29, this conversation
**Review fingerprint:** d22ae39c3c05 (review ecd5803f, type/tags 7ede13b6)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-08-29, this conversation
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (d22ae39c3c05) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

### [GATE-PLAN] — ❌ FAIL | 2026-08-29

**Status remains:** draft
**Failed criteria:**

- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` carries no `**Author verdict:** `SCENARIO DRAFTED: (not-applicable|automatable|manual) | <n>`` line (0 found, exactly 1 required; the section is absent)
  **Required action:** record the author verdict in the Task

### [GATE-PLAN] — ✅ PASS | 2026-08-29

**Status upgrade:** draft → approved

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: RULE` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (1 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 616 chars, 4 sentences
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: `## Prior Art Research` section present
- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — All 4 checklist items are `[x]`: 5/5 checklist items `[x]`
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: Sibling scan `[x]` with an explicit N/A reason
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: 2 numbered alternatives, each with Pro and Con
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
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` present with 2 prior entries (none from a later gate)
- GATE-WRITE — No `## Status` or `## Classification` sections in the body (these are frontmatter fields): no `## Status` / `## Classification` body sections
- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-08-29, this conversation
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (d22ae39c3c05) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/RULE-019-enforce-deterministic-github-issue-intake-at-creation.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/RULE-019-enforce-deterministic-github-issue-intake-at-creation.md`, whose basename is the spec's
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
