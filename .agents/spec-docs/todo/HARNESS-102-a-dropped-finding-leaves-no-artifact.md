---
status: approved
type: INFRA
tags: [harness, cli]
lane: L1
---

# HARNESS-102: the unmechanized half of find→issue

## Problem

`find-to-issue` instructed filing a GitHub Issue as the default action for a mid-task finding, and
`allocate-work-item-id.mjs` silently created a new GitHub Issue whenever `--issue` was omitted and no
existing Issue matched the title exactly (`work-item-issue-binding.mjs` → `defaultCreateIssue`). Both
are auto-generation paths the maintainer asked to close, and together they are also HARNESS-102's own
obstacle: whether a finding was filed is not observable from the tree — no file, no commit, no log
line — so the failure state was an absence a repository scan cannot see.

## Prior Art Research

Waived: this is a repository-local harness/tooling policy change with no external product or protocol
behavior to research.

## Architecture Review

### Affected Scope

- `scripts/harness/work-item-issue-binding.mjs`
- `scripts/harness/allocate-work-item-id.mjs`
- `.agents/skills/find-to-issue/SKILL.md`
- `.agents/skills/index.md`
- `.agents/learn.md` (new)

### Alternatives Considered

1. Refuse Issue creation only in the allocator, leave `find-to-issue` filing Issues directly.
   - Pro: smallest diff; closes the one path with a network side effect.
   - Con: `find-to-issue` remains the default mid-task reflex, so a routine finding still costs a
     round-trip and grows the Issue count — the measured problem this change exists to stop.
2. Close both: the allocator refuses to auto-create an Issue, and `find-to-issue` records a mid-task
   finding in `.agents/learn.md` (a local, append-only file) instead of filing one, while a person can
   still open a GitHub Issue by hand at any time.
   - Pro: removes the reflex at its source, not just its most visible symptom; the learn.md record is
     also HARNESS-102's own suggested "make the absence leave a trace" direction, so the same change
     resolves both.
   - Con: mid-task findings recorded locally are not immediately visible outside the session until a
     normal commit or an explicit lesson-processing pass carries them out — accepted, and stated as
     the design in `learning-loop.md` and the rewritten `find-to-issue` skill.

### Decision

Alternative 2. Fixing only the allocator leaves the higher-traffic path — the skill instructing
"file an issue" on every mid-task discovery — untouched, which is the actual driver of Issue-count
growth the maintainer measured. `.agents/learn.md` also directly answers HARNESS-102's own open
question about an unobservable absence, so one change closes both items instead of leaving HARNESS-102
open beside a narrower allocator fix.

**Delivery mode:** `single`

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: repository harness-tooling and agent-skill policy, not a command family
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and no
      layer or product-family reclassification.

## Fallback & Degradation Declaration

None

## Solution

1. `work-item-issue-binding.mjs`: remove `defaultCreateIssue`/`defaultCloseIssue`/`closeCreatedIssue`
   and the `createIssue` parameter of `resolveIssueNumber`; when `--issue` is omitted and no exact
   title match exists, throw an error naming the two remaining options (`--issue`, or a
   `.agents/learn.md` record) instead of creating an Issue.
2. `allocate-work-item-id.mjs`: drop the now-dead `closeCreatedIssue` cleanup branch and re-export;
   update the header/usage comments to match the new, creation-free behavior.
3. `.agents/skills/find-to-issue/SKILL.md`: rewrite the default action from "file a GitHub Issue" to
   "append one record to `.agents/learn.md`" (the five-field format `.agents/learn.md` declares), keep
   the existing depth-routing and "recording is not authorization" guidance, and add that a GitHub
   Issue is still available by hand for a finding ready to be tracked externally.
4. Create `.agents/learn.md` with the record format and a pointer to `learning-loop.md` for how entries
   are later worked as a batch, only on the user's explicit request.
5. Update `.agents/skills/index.md`'s one-line `find-to-issue` description to match.

## Affected Files

- `scripts/harness/work-item-issue-binding.mjs`
- `scripts/harness/allocate-work-item-id.mjs`
- `scripts/harness/__tests__/allocate-work-item-id.test.mjs`
- `.agents/skills/find-to-issue/SKILL.md`
- `.agents/skills/index.md`
- `.agents/learn.md`

## Completion Criteria

- [ ] TC-01: `pnpm exec vitest run scripts/harness/__tests__/allocate-work-item-id.test.mjs` → exits 0,
      and the "never files a GitHub Issue" case exits 1 with the old create-on-missing-title behavior
      restored
- [ ] TC-02: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` → exits 0

## Test Plan

| TC-ID | Test Type | Tool / Approach                             | Notes                                                                          |
| ----- | --------- | ------------------------------------------- | ------------------------------------------------------------------------------ |
| TC-01 | Unit      | `pnpm exec vitest run` on the named test    | RED with the old create-on-missing-title behavior restored, GREEN with the fix |
| TC-02 | Suite     | `run-all-scans.mjs --affected --context pr` | Regression — the affected set, not the full suite                              |

## User Execution Test Scenarios

Not applicable — process change with no runnable user-facing behaviour.

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This changes internal harness/agent-workflow tooling (a Node CLI script and an agent
skill's instructions); it has no end-user runtime surface, CLI behavior, SDK contract, or
product-facing interaction to execute.

## Tasks

- [ ] `.agents/tasks/HARNESS-102-a-dropped-finding-leaves-no-artifact.md` — todo

## Evidence Log

### [GATE-APPROVAL] — ✅ PASS | 2026-09-06

**Status upgrade:** draft → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "이 문제를 해결하고 해결한 것이 origin/develop 브랜치에 모두 머지될 때까지 작업하세요. 이 작업을 할 때 절차가 너무 복잡하면 작업이 지연되니까 많은 검증 작업 중 꼭 필요한 검증만 진행하고, 작업을 최대한 빠르게 진행하며, pr을 만들지말고 브랜치에 머지해서 최종 origin/develop 까지 머지 완료하면 됩니다. 머지하는데 있어서 장애물은 너가 다 해결하면서 반복해서 작업하고 완료하세요."
**Given:** 2026-09-06, this conversation
**Review fingerprint:** 2761d88b7c60 (review 15ea0ef6, type/tags 79e13179)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-06, this conversation
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (2761d88b7c60) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `e4e2762d47f9` · base `origin/develop@e4e2762d47f9` · document `.agents/spec-docs/draft/HARNESS-102-a-dropped-finding-leaves-no-artifact.md` blob `5a14bbae8873` (untracked)

### [GATE-PLAN] — ✅ PASS | 2026-09-06

**Status upgrade:** draft → approved

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: INFRA` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (2 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 576 chars, 2 sentences
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: `## Prior Art Research` section present
- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — All 4 checklist items are `[x]`: 5/5 checklist items `[x]`
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
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` present with 1 prior entry (none from a later gate)
- GATE-WRITE — No `## Status` or `## Classification` sections in the body (these are frontmatter fields): no `## Status` / `## Classification` body sections
- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-06, this conversation
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (2761d88b7c60) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/HARNESS-102-a-dropped-finding-leaves-no-artifact.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/HARNESS-102-a-dropped-finding-leaves-no-artifact.md`, whose basename is the spec's
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `e4e2762d47f9` · base `origin/develop@e4e2762d47f9` · document `.agents/spec-docs/draft/HARNESS-102-a-dropped-finding-leaves-no-artifact.md` blob `fd54196191d4` (untracked)
