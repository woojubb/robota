---
status: approved
type: INFRA
tags: [harness, process]
lane: L1
---

# PROC-2423: A finding never opens a new GitHub issue — record it on the existing one

Paired with `.agents/tasks/PROC-2423-a-finding-never-opens-a-new-github-issue-record-it-on-the-existing-one.md`. Arising from [issue #2423](https://github.com/woojubb/robota/issues/2423).

## Problem

The rules still route a finding made during work toward a NEW GitHub issue. `.agents/rules/finding-depth.md`
§ The rule says a FOUNDATIONAL finding must "register its GitHub issue", § Where a root item lives repeats
"registers its GitHub issue", `.agents/tasks/README.md` names `gh issue create` as the first option when
no Issue title matches, the `find-to-issue` skill has a section titled "A GitHub issue is still allowed",
and `node scripts/harness/allocate-work-item-id.mjs PREFIX "<unmatched title>"` refuses with
"open it yourself (`gh issue create`) and pass its number with --issue". The owner has directed the
opposite: the tracker was consolidated to a fixed set of umbrella issues and stays that size, so a finding
is recorded on the existing issue whose scope contains it — a comment or a body update — and a new issue
is the owner's direct decision alone. Until the documents say so, every agent reading them files new
issues in good faith (five were opened and closed within an hour on the day of the directive), and the
in-repo memory note that records the directive is the only thing standing in the way.

## Prior Art Research

Waived: rule amendment on the owner's direct instruction; no external product surface

## Architecture Review

### Affected Scope

- `.agents/rules/finding-depth.md` — new § "A finding never opens a new GitHub issue"; the FOUNDATIONAL bullet and the root-item filing paragraph point at it
- `.agents/rules/backlog-execution.md` — § GitHub Issue ↔ Task Boundary cites the rule
- `.agents/tasks/README.md` — the registering-Issue paragraph and the allocation step name the existing umbrella, not `gh issue create`
- `.agents/skills/find-to-issue/SKILL.md` — the "still allowed" section becomes "not opened for a finding"
- `scripts/harness/work-item-issue-binding.mjs`, `scripts/harness/allocate-work-item-id.mjs` — the refusal message and header comment name the umbrella route
- `scripts/harness/__tests__/allocate-work-item-id.test.mjs` — one case pinning the refusal message
- `.agents/memory/no-new-github-issues.md` — points at the rule
- No product package changes.

### Alternatives Considered

1. Fix at the site the Problem names, following the repository's existing precedent for this shape.
   - Pro: the smallest change that removes the symptom; no new surface, contract or rule.
   - Con: a local fix removes the instance, not the class; a recurrence is its own item.
2. Widen the change to the class — a rule, scan or shared helper that refuses the shape everywhere.
   - Pro: removes the class rather than the instance.
   - Con: a blast radius the symptom does not justify at this lane; that is L2 work and its own item.

### Decision

**Alternative 1.** The rule is amended where the routing lives (finding-depth.md owns depth and filing), every document that named the old option is pointed at it, and the one mechanical hint that named `gh issue create` is corrected with a pinned test; a scan that greps rule prose for the phrase would be a class-level guard whose blast radius the directive does not need — the documents are the thing being fixed.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: rule amendment on the owner's direct instruction; no external product surface
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

None

## Solution

1. `finding-depth.md` gains § "A finding never opens a new GitHub issue": choose the open issue whose
   scope contains the finding (the issue the work is done under, else the area umbrella), record it as a
   comment or a body update, allocate the Task ID against that issue, and treat a claimed ID as a dated
   entry on the existing record; a new issue is opened only on the owner's explicit direction. The
   FOUNDATIONAL bullet and the "Where a root item lives" filing paragraph reference it. The section states
   the invariant; the directive itself stays verbatim in `.agents/memory/no-new-github-issues.md`
   (rule documents carry no case narrative).
2. `backlog-execution.md` § GitHub Issue ↔ Task Boundary, `.agents/tasks/README.md` and the
   `find-to-issue` skill point at the rule and stop naming `gh issue create` as an option.
3. `work-item-issue-binding.mjs` refuses an unmatched title by naming the umbrella route; the test TC-01
   names pins that the message names the existing umbrella and never `gh issue create`.

## Affected Files

- `.agents/rules/finding-depth.md`
- `.agents/rules/backlog-execution.md`
- `.agents/tasks/README.md`
- `.agents/skills/find-to-issue/SKILL.md`
- `.agents/memory/no-new-github-issues.md`
- `scripts/harness/work-item-issue-binding.mjs`
- `scripts/harness/allocate-work-item-id.mjs`
- `scripts/harness/__tests__/allocate-work-item-id.test.mjs`

## Completion Criteria

- [ ] TC-01: `pnpm exec vitest run scripts/harness/__tests__/allocate-work-item-id.test.ts -t "names the existing umbrella"` → exits 0, and exits 1 with `scripts/harness/work-item-issue-binding.mjs` reverted to `HEAD~1`
- [ ] TC-02: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` → exits 0
- [ ] TC-03: `pnpm exec vitest run scripts/harness/__tests__/allocate-work-item-id.test.mjs` → exits 0 on the whole file, not only the new case

## Test Plan

| TC-ID | Test Type | Tool / Approach                                                                 | Notes                                                                                                                                 |
| ----- | --------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | Unit      | `pnpm exec vitest run` on the named test                                        | RED with the fix reverted, GREEN with it — `scripts/harness/__tests__/allocate-work-item-id.test.mjs` > "names the existing umbrella" |
| TC-02 | Suite     | `run-all-scans.mjs --affected --context pr`                                     | Regression — the affected set, not the full suite                                                                                     |
| TC-03 | Unit      | `pnpm exec vitest run scripts/harness/__tests__/allocate-work-item-id.test.mjs` | The whole test file                                                                                                                   |

## User Execution Test Scenarios

Not applicable — no runnable user-facing behaviour changes; verification evidence is recorded in the engineering test plan (TC-01 to TC-03).

Recorded as the rule's required choice rather than skipped.

## Tasks

- [ ] `.agents/tasks/PROC-2423-a-finding-never-opens-a-new-github-issue-record-it-on-the-existing-one.md` — todo

## Evidence Log

### [GATE-APPROVAL] — ❌ FAIL | 2026-09-19

**Status remains:** draft
**Approval route:** `CLASS`
**Class:** `LANE-L0-L1`
**Instruction (verbatim):** "작업하다 발견되는 이슈는 새 깃헙이슈로 추가하지 않고 기존 이슈에 댓글이나 본문에 추가하는 걸로 레포 규칙 파일을 바꿔주세요."
**Given:** 2026-09-19, this conversation (Claude Code session, 2026-09-19)
**Evidence condition met:** `node scripts/harness/scan-lane-declaration.mjs --changed <2 path(s)> --diff-file <diff vs origin/develop> --trailers-file <Lane: L1>` over 2 changed path(s) — committed and working-tree changes vs origin/develop (merge base 724f4138e375) → exit 0, `lane-declaration summary: violations=0 result=PASS` (Lane L1 (spec-doc frontmatter .agents/spec-docs/draft/PROC-2423-a-finding-never-opens-a-new-github-issue-record-it-on-the-existing-one.md) is at or above the floor L0)
**Review fingerprint:** 8f32aa026628 (review f2ed2afe, type/tags 75a55883)
**Failed criteria:**

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS instruction does not exactly match the canonical instruction registered for `LANE-L0-L1`; comparison preserves whitespace and Unicode code points.
  **Required action:** rewrite the entry in the delegated-approval form
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: route CLASS instruction does not exactly match the canonical instruction registered for `LANE-L0-L1`; comparison preserves whitespace and Unicode code points.
  **Required action:** rewrite the entry in the form backlog-execution.md § Delegated Approval Classes specifies
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: route CLASS instruction does not exactly match the canonical instruction registered for `LANE-L0-L1`; comparison preserves whitespace and Unicode code points.
  **Required action:** rewrite the entry in the form backlog-execution.md § Delegated Approval Classes specifies
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS instruction does not exactly match the canonical instruction registered for `LANE-L0-L1`; comparison preserves whitespace and Unicode code points.
  **Required action:** rewrite the entry in the delegated-approval form

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `724f4138e375` · base `origin/develop@724f4138e375` · document `.agents/spec-docs/draft/PROC-2423-a-finding-never-opens-a-new-github-issue-record-it-on-the-existing-one.md` blob `ae30abe3f414` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-19

**Status upgrade:** draft → approved
**Approval route:** `CLASS`
**Class:** `LANE-L0-L1`
**Instruction (verbatim):** "좋아 모두 승인한다. 빠르게 적용해줘. 필요하면 병렬 에이전트와 workflow를 적극 적용해줘"
**Given:** 2026-08-28, the PROC-016 approval conversation, 2026-08-28
**Evidence condition met:** `node scripts/harness/scan-lane-declaration.mjs --changed <2 path(s)> --diff-file <diff vs origin/develop> --trailers-file <Lane: L1>` over 2 changed path(s) — committed and working-tree changes vs origin/develop (merge base 724f4138e375) → exit 0, `lane-declaration summary: violations=0 result=PASS` (Lane L1 (spec-doc frontmatter .agents/spec-docs/draft/PROC-2423-a-finding-never-opens-a-new-github-issue-record-it-on-the-existing-one.md) is at or above the floor L0) — note: scan-lane-declaration exits 0 on this branch and the document declares lane: L1; the change itself was requested directly by the owner in this conversation on 2026-09-19 ('작업하다 발견되는 이슈는 새 깃헙이슈로 추가하지 않고 기존 이슈에 댓글이나 본문에 추가하는 걸로 레포 규칙 파일을 바꿔주세요.')
**Review fingerprint:** 8f32aa026628 (review f2ed2afe, type/tags 75a55883)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <2)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (8f32aa026628) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `724f4138e375` · base `origin/develop@724f4138e375` · document `.agents/spec-docs/draft/PROC-2423-a-finding-never-opens-a-new-github-issue-record-it-on-the-existing-one.md` blob `03e3c9605aad` (untracked)

### [GATE-PLAN] — ✅ PASS | 2026-09-19

**Status upgrade:** draft → approved

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: INFRA` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (2 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 1121 chars, 4 sentences
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: `## Prior Art Research` section present
- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — All 4 checklist items are `[x]`: 5/5 checklist items `[x]`
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: Sibling scan `[x]` with an explicit N/A reason
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: 2 numbered alternatives, each with Pro and Con
- GATE-WRITE — Decision references the trade-off that drove the choice: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — **New-surface placement (conditional):** IF the spec introduces a new package / app / presentation or interfac: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Every item has a `TC-N` prefix (TC-01, TC-02, …) — items without TC-N prefix = FAIL: 3 criteria, all `TC-NN:` prefixed
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — No criterion uses: "works correctly", "no errors", "implemented", "displays correctly": none of "works correctly", "no errors", "implemented", "displays correctly" appears
- GATE-WRITE — `## Test Plan` section present: `## Test Plan` present
- GATE-WRITE — One row exists for each TC-N in Completion Criteria (count must match): 3 Test Plan rows = 3 TC criteria
- GATE-WRITE — Each row has a non-empty Test Type and Tool/Approach (no "TBD"): 3 rows with Test Type and Tool, no TBD
- GATE-WRITE — Rows where Tool is "manual" have a non-empty Notes entry explaining why automated test is not possible: 0 manual row(s), each with Notes
- GATE-WRITE — Tasks section present with placeholder: `## Tasks` present
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` present with 2 prior entries (none from a later gate)
- GATE-WRITE — No `## Status` or `## Classification` sections in the body (these are frontmatter fields): no `## Status` / `## Classification` body sections
- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <2)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (8f32aa026628) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/PROC-2423-a-finding-never-opens-a-new-github-issue-record-it-on-the-existing-one.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/PROC-2423-a-finding-never-opens-a-new-github-issue-record-it-on-the-existing-one.md`, whose basename is the spec's
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `724f4138e375` · base `origin/develop@724f4138e375` · document `.agents/spec-docs/draft/PROC-2423-a-finding-never-opens-a-new-github-issue-record-it-on-the-existing-one.md` blob `581e38a75045` (untracked)
