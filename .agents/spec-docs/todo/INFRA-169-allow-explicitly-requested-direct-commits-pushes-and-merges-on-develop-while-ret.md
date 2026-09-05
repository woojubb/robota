---
status: approved
type: INFRA
tags: [cli, typescript]
lane: L1
---

# INFRA-169: Allow explicitly requested direct commits, pushes, and merges on develop

## Problem

The branch policy and local commit guards still describe and enforce `develop` as a protected
commit target even though the maintainer has explicitly authorized direct integration-branch
updates. This causes a direct `develop` commit to be rejected while `main`/`master` protections
remain necessary.

## Prior Art Research

Waived: this is a repository-local policy alignment with no external product or protocol behavior.

## Architecture Review

### Affected Scope

- `.agents/rules/git-branch.md`
- `.claude/hooks/branch-guard.sh`
- `.husky/pre-commit`

### Alternatives Considered

1. Remove only the prose prohibition. Pro: smallest textual change. Con: local hooks would still
   reject the authorized workflow.
2. Align the prose and both local commit guards while retaining release-branch protections. Pro:
   one coherent policy across all local enforcement points. Con: direct integration commits become
   available when explicitly requested.

### Decision

Choose alternative 2 because the requested workflow must be represented consistently by the rule,
the Claude command guard, and the Git-native pre-commit guard. Push and merge behavior already
allows `develop`; `main` and `master` remain blocked.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: repository workflow policy, not a command family
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None

## Solution

Remove `develop` from the protected-commit sets in the policy text, `branch-guard.sh`, and
`.husky/pre-commit`; retain the existing release-branch protections and all branch-creation,
verification, and review requirements.

## Affected Files

- `.agents/rules/git-branch.md`
- `.claude/hooks/branch-guard.sh`
- `.husky/pre-commit`

## Completion Criteria

- [ ] TC-01: static policy and hook assertions show `develop` is not rejected for commits while
      `main` and `master` remain rejected.
- [ ] TC-02: `pnpm harness:scan` exits 0 on the final tree.

## Test Plan

| TC-ID | Test Type | Tool / Approach         | Notes                                         |
| ----- | --------- | ----------------------- | --------------------------------------------- |
| TC-01 | Unit      | shell/static assertions | Verify both allow and deny branches.          |
| TC-02 | CI smoke  | `pnpm harness:scan`     | Repository-wide policy and consistency scans. |

## Tasks

- [ ] `.agents/tasks/INFRA-169-allow-explicitly-requested-direct-commits-pushes-and-merges-on-develop-while-ret.md` — todo

## Evidence Log

### [GATE-PLAN] — ❌ FAIL | 2026-09-06

**Status remains:** draft
**Failed criteria:**

- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/INFRA-169-allow-explicitly-requested-direct-commits-pushes-and-merges-on-develop-while-ret.md`, whose basename is not the spec's (INFRA-169-allow-explicitly-requested-direct-commits-pushes-and-merges-on-develop.md)
  **Required action:** pair the Task and the spec by basename

**Judged at:** HEAD `d9b521a06c71` · base `origin/develop@d9b521a06c71` · document `.agents/spec-docs/draft/INFRA-169-allow-explicitly-requested-direct-commits-pushes-and-merges-on-develop.md` blob `be959b47826d` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-06

**Status upgrade:** draft → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "변경은 매우 쉬운 작업이니 빨리 작업해서 develop 을 베이스브랜치로 pr올려서 바로 pr을 머지하세요"
**Given:** 2026-09-06, this conversation
**Review fingerprint:** 0d38b9063aa5 (review c397f578, type/tags aba2e7e1)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-06, this conversation
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (0d38b9063aa5) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

**Judged at:** HEAD `d9b521a06c71` · base `origin/develop@d9b521a06c71` · document `.agents/spec-docs/draft/INFRA-169-allow-explicitly-requested-direct-commits-pushes-and-merges-on-develop-while-ret.md` blob `66f46570736b` (untracked)

### [GATE-PLAN] — ✅ PASS | 2026-09-06

**Status upgrade:** draft → approved

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: INFRA` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (2 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 300 chars, 2 sentences
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: `## Prior Art Research` section present
- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — All 4 checklist items are `[x]`: 4/4 checklist items `[x]`
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: Sibling scan `[x]` with an explicit N/A reason
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: 2 numbered alternatives, each with Pro and Con
- GATE-WRITE — Decision references the trade-off that drove the choice: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — **New-surface placement (conditional):** IF the spec introduces a new package / app / presentation or interfac: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Every item has a `TC-N` prefix (TC-01, TC-02, …) — items without TC-N prefix = FAIL: 2 criteria, all `TC-NN:` prefixed
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — No criterion uses: "works correctly", "no errors", "implemented", "displays correctly": none of "works correctly", "no errors", "implemented", "displays correctly" appears
- GATE-WRITE — `## Test Plan` section present: `## Test Plan` present
- GATE-WRITE — One row exists for each TC-N in Completion Criteria (count must match): 2 Test Plan rows = 2 TC criteria
- GATE-WRITE — Each row has a non-empty Test Type and Tool/Approach (no "TBD"): 2 rows with Test Type and Tool, no TBD
- GATE-WRITE — Rows where Tool is "manual" have a non-empty Notes entry explaining why automated test is not possible: 0 manual row(s), each with Notes
- GATE-WRITE — Tasks section present with placeholder: `## Tasks` present
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` present with 2 prior entries (none from a later gate)
- GATE-WRITE — No `## Status` or `## Classification` sections in the body (these are frontmatter fields): no `## Status` / `## Classification` body sections
- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-06, this conversation
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (0d38b9063aa5) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/INFRA-169-allow-explicitly-requested-direct-commits-pushes-and-merges-on-develop-while-ret.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/INFRA-169-allow-explicitly-requested-direct-commits-pushes-and-merges-on-develop-while-ret.md`, whose basename is the spec's
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`

**Judged at:** HEAD `d9b521a06c71` · base `origin/develop@d9b521a06c71` · document `.agents/spec-docs/draft/INFRA-169-allow-explicitly-requested-direct-commits-pushes-and-merges-on-develop-while-ret.md` blob `7f612a66efe1` (untracked)
