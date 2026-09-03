---
status: approved
type: INFRA
tags: [process, github, batching]
lane: L1
---

# PROC-032: batch-resolve the open GitHub issue backlog locally

Paired with `.agents/tasks/PROC-032-batch-resolve-the-open-github-issue-backlog-locally.md`. Arising from [issue #2512](https://github.com/woojubb/robota/issues/2512).

## Problem

On 2026-09-04 `gh issue list --state open --limit 500` returns 227 open issues while the per-issue delivery loop (one Task, one spec, one PR, one review round per item) closes far fewer items per day than intake adds, so the backlog grows and stale items accumulate that are already fixed on `develop`, superseded by later redesigns, or blocked on a spec that nobody has filed. Reproduction: compare the open count today with the count one week earlier — the net growth is positive, and a sample of the oldest open items shows their cited files or mechanisms no longer exist. The symptom is a queue that no longer tells the team what is actually undone.

## Prior Art Research

Waived: repository-local batch maintenance; no product, protocol, package, API or UI design question

## Architecture Review

### Affected Scope

- `scripts/harness/**` and `.claude/hooks/**` — small scan, gate and hook defects named by the backlog
- `.agents/rules/**`, `.agents/skills/**`, `packages/*/docs/SPEC.md` — documentation drift named by the backlog
- `packages/*/src/**` — bounded contract and runtime defects named by the backlog
- A local, out-of-repository ledger under `/tmp/robota-issues/` holding every issue and its disposition

### Alternatives Considered

1. Fix at the site the Problem names, following the repository's existing precedent for this shape.
   - Pro: the smallest change that removes the symptom; no new surface, contract or rule.
   - Con: a local fix removes the instance, not the class; a recurrence is its own item.
2. Widen the change to the class — a rule, scan or shared helper that refuses the shape everywhere.
   - Pro: removes the class rather than the instance.
   - Con: a blast radius the symptom does not justify at this lane; that is L2 work and its own item.

### Decision

**Alternative 1.** Every issue is dispositioned once from one local snapshot and every fix is the smallest change that removes the named symptom; class-level redesigns the backlog asks for are recorded as DEFER with their reason so they can be filed as their own L2 items instead of stalling the batch.

**Delivery mode:** `single`

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: repository-local batch maintenance; no product, protocol, package, API or UI design question
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

None

## Solution

1. Download every open issue once into a local queue and triage each into ALREADY-DONE, SUPERSEDED, FIX-SMALL, FIX-MEDIUM, DEFER or WONTFIX with concrete repository evidence.
2. Apply every FIX disposition as a minimal change with its proving test or document update, one conventional commit per issue naming `(#N)`, on one sweep branch cut from `origin/develop`.
3. Verify the whole batch once with `pnpm harness:verify-like-ci`, then merge to `develop`.
4. Generate the disposition ledger that becomes the closing comment for every issue in one bulk action.

## Affected Files

- `scripts/harness/*.mjs` and `scripts/harness/__tests__/*.test.mjs` named by FIXED issues
- `.claude/hooks/*.sh` named by FIXED issues
- `.agents/rules/*.md`, `.agents/skills/*/SKILL.md`, `packages/*/docs/SPEC.md` named by FIXED issues
- `packages/*/src/**` named by FIXED issues
- `.agents/tasks/PROC-032-batch-resolve-the-open-github-issue-backlog-locally.md` (this pair)

## Completion Criteria

- [ ] TC-01: Observable: the local ledger `/tmp/robota-issues/status.json` holds exactly one entry per downloaded open issue (227 on 2026-09-04) and every entry carries a non-empty disposition from the closed set.
- [ ] TC-02: Command: `git log --format=%s origin/develop..HEAD` → every FIXED issue appears in exactly one subject as `(#N)`, and `pnpm exec commitlint --from origin/develop` exits 0.
- [ ] TC-03: Command: `pnpm harness:verify-like-ci` → exits 0 on the batch head.
- [ ] TC-04: Observable: the generated `DISPOSITIONS.md` lists every issue number exactly once with its disposition and note.

## Test Plan

| TC-ID | Test Type | Tool / Approach                                     | Notes                                       |
| ----- | --------- | --------------------------------------------------- | ------------------------------------------- |
| TC-01 | automated | `python3 gen.py` ledger count and disposition check | one entry per issue, closed disposition set |
| TC-02 | automated | `git log` subject scan plus `commitlint --from`     | one `(#N)` per FIXED issue                  |
| TC-03 | automated | `pnpm harness:verify-like-ci`                       | the CI-equivalent entry point, run once     |
| TC-04 | automated | `DISPOSITIONS.md` generated from the ledger         | every issue once                            |

## User Execution Test Scenarios

Not applicable — the batch is repository maintenance driven by a local ledger and adds no runnable product surface of its own; each FIXED issue's own tests prove its change.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** No new CLI, TUI, API, or end-user interaction is introduced by the batch itself.

## Tasks

- [ ] `.agents/tasks/PROC-032-batch-resolve-the-open-github-issue-backlog-locally.md` — todo

## Evidence Log

### [GATE-APPROVAL] — ✅ PASS | 2026-09-04

**Status upgrade:** draft → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "지금부터 깃헙 이슈를 처리할건데, '/tmp' 폴더에 작업용 폴더를 만들어서 깃헙 이슈를 모두 한번에 한꺼번에 다운받아서 로컬 엑세스를 하면서 처리하는 식으로 작업할거다. … 지금부터 반복해서 이 목표를 끝내줘. 완료되면 깃헙이슈에 한번에 모두 닫을 수 있는 권한을 주겠다. 그 전까지는 로컬에서 이슈를 처리하면서 끝까지 처리하라. / Pr없이 검증만 되면 develop에 바로 머지하세요"
**Given:** 2026-09-04, this conversation
**Review fingerprint:** 95d8aea1b9d6 (review 7fd8a638, type/tags 4832e257)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-04, this conversation
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (95d8aea1b9d6) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

### [GATE-PLAN] — ✅ PASS | 2026-09-04

**Status upgrade:** draft → approved

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: INFRA` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (3 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 653 chars, 3 sentences
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
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` present with 1 prior entry (none from a later gate)
- GATE-WRITE — No `## Status` or `## Classification` sections in the body (these are frontmatter fields): no `## Status` / `## Classification` body sections
- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-04, this conversation
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (95d8aea1b9d6) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/PROC-032-batch-resolve-the-open-github-issue-backlog-locally.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/PROC-032-batch-resolve-the-open-github-issue-backlog-locally.md`, whose basename is the spec's
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
