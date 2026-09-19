---
status: approved
type: PERF
tags: [perf]
lane: L1
---

# PERF-2423: reuse local review context and inspect only repair deltas

Paired with `.agents/tasks/PERF-2423-reuse-local-review-context-and-inspect-only-repair-deltas.md`. Arising from [issue #2423](https://github.com/woojubb/robota/issues/2423).

## Problem

Each repair round in the local PR-review loop can spawn a fresh `pr-review-reviewer` and ask it to
re-read `origin/develop...HEAD`. A multi-round review therefore repeatedly reloads the same plan,
Task, branch diff, and source even though only the prior findings and the repair delta changed.
The measured handoff for one work unit recorded six fresh reviewer rounds, 338 tool calls, and about
861k reviewer tokens. The repeated reads add cost and latency without adding review coverage.

## Prior Art Research

Waived: repository-internal orchestration efficiency change grounded by the supplied six-round measurement and the existing execution-cadence/review contracts; no product or public API choice requires external comparison.

## Architecture Review

### Affected Scope

- `.agents/rules/execution-cadence.md` and `.agents/rules/index.md` — own and route the repair-review cadence invariant.
- `.agents/skills/pr-finding-resolution-loop/SKILL.md` — preserve the first reviewer handle and resume it for local repair rounds.
- `.agents/skills/delegated-refactor-green-gate/SKILL.md` — apply the same continuation contract to its bounded repair loop.
- `.claude/agents/pr-review-reviewer.md` — define the resumed follow-up review contract without weakening dynamic verification.
- `scripts/harness/scan-review-findings.mjs` and its Vitest file — refuse removal of context reuse or delta scoping.
- No product package or public contract changes.

### Alternatives Considered

1. Keep spawning a fresh reviewer on every repair round and continue full-branch re-review.
   - Pro: every round is independently self-contained.
   - Con: the reviewer repeatedly reloads unchanged evidence and cannot inherit the prior finding context.
2. Spawn once, preserve the returned reviewer handle, and resume it with prior findings plus `git diff <previous-head>..HEAD`.
   - Pro: retains the reviewer that found the defects, directly verifies closure, and limits rereads to changed evidence.
   - Con: orchestration must retain the handle and previous reviewed head until the loop ends.
3. Cap the number of rounds or stop running dynamic verification on follow-ups.
   - Pro: gives a hard cost ceiling.
   - Con: can stop with unresolved MUST/SHOULD findings or remove the execution checks that found the measured defects.

### Decision

**Alternative 2.** The first round remains a whole-branch review with dynamic verification. Every
repair round resumes the same reviewer through `SendMessage`, names each prior finding and claimed
fix, and reviews only `git diff <previous-head>..HEAD`; a new whole-branch pass is allowed only when
the repair materially widens the changed set. The existing no-progress/round-bound rules remain the
termination authority, while `ACTIONABLE FINDINGS: 0` means unresolved MUST/SHOULD are clear.

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

1. Amend `execution-cadence.md` so a repair review preserves the existing guardian context, checks
   prior findings against source, and reviews only the previous-head delta after the first pass.
2. Update both orchestrators that can re-drive `pr-review-reviewer`: capture the first dispatch's
   `agentId` and reviewed head, then use `SendMessage` for subsequent rounds with the finding summary,
   claimed fix locations, and `git diff <previous-head>..HEAD`. Do not ask for another whole-branch
   audit unless the repair materially widens the changed set.
3. Update the reviewer agent so follow-ups verify closure and changed tests while retaining dynamic
   execution, value-path reach, and regression RED-proof responsibilities.
4. Extend the existing review-contract scan and unit fixtures so removing same-reviewer continuation
   or delta scoping fails mechanically.

## Affected Files

- `.agents/rules/execution-cadence.md`
- `.agents/rules/index.md`
- `.agents/skills/pr-finding-resolution-loop/SKILL.md`
- `.agents/skills/delegated-refactor-green-gate/SKILL.md`
- `.claude/agents/pr-review-reviewer.md`
- `scripts/harness/scan-review-findings.mjs`
- `scripts/harness/__tests__/scan-review-findings.test.mjs`

## Completion Criteria

- [ ] TC-01: `pnpm exec vitest run scripts/harness/__tests__/scan-review-findings.test.mjs -t "requires resumed delta review"` → exits 0, and the same case exits 1 when the continuity/delta assertions are removed from `scan-review-findings.mjs`.
- [ ] TC-02: `pnpm exec vitest run scripts/harness/__tests__/scan-review-findings.test.mjs` → exits 0 on the whole test file.
- [ ] TC-03: `node scripts/harness/scan-review-findings.mjs` → exits 0 and reports the expanded review-artifact population.
- [ ] TC-04: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` → exits 0.

## Test Plan

| TC-ID | Test Type | Tool / Approach                                                            | Notes                                                        |
| ----- | --------- | -------------------------------------------------------------------------- | ------------------------------------------------------------ |
| TC-01 | Unit      | Focused Vitest case in `scan-review-findings.test.mjs`                      | RED with the new scan assertions removed, GREEN with them    |
| TC-02 | Unit      | Whole `scripts/harness/__tests__/scan-review-findings.test.mjs`             | Existing review-pipeline contracts remain green              |
| TC-03 | Smoke     | `node scripts/harness/scan-review-findings.mjs`                             | Real-tree contract and exact examined population             |
| TC-04 | Suite     | `run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` | Regression over the affected harness scope                   |

## User Execution Test Scenarios

Not applicable — no runnable user-facing behaviour changes; verification evidence is recorded in the engineering test plan (TC-01 to TC-04).

Recorded as the rule's required choice rather than skipped.

## Tasks

- [ ] `.agents/tasks/PERF-2423-reuse-local-review-context-and-inspect-only-repair-deltas.md` — todo

## Evidence Log

### [GATE-APPROVAL] — ✅ PASS | 2026-09-20

**Status upgrade:** draft → approved
**Approval route:** `CLASS`
**Class:** `LANE-L0-L1`
**Instruction (verbatim):** "좋아 모두 승인한다. 빠르게 적용해줘. 필요하면 병렬 에이전트와 workflow를 적극 적용해줘"
**Given:** 2026-08-28, PROC-016 approval conversation, 2026-08-28
**Evidence condition met:** `node scripts/harness/scan-lane-declaration.mjs --changed <3 path(s)> --diff-file <diff vs origin/develop> --trailers-file <Lane: L1>` over 3 changed path(s) — committed and working-tree changes vs origin/develop (merge base c81dd4ff7569) → exit 0, `lane-declaration summary: violations=0 result=PASS` (Lane L1 (spec-doc frontmatter .agents/spec-docs/draft/PERF-2423-reuse-local-review-context-and-inspect-only-repair-deltas.md) is at or above the floor L0) — note: scan-lane-declaration examined 2 changed paths and exited 0; the document declares Lane L1, at or above the measured L0 floor
**Review fingerprint:** 701ece52e3d9 (review 8e04bbfd, type/tags c7ff2344)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <3)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (701ece52e3d9) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `c81dd4ff7569` · base `origin/develop@c81dd4ff7569` · document `.agents/spec-docs/draft/PERF-2423-reuse-local-review-context-and-inspect-only-repair-deltas.md` blob `72d98100ee09` (modified)

### [GATE-PLAN] — ❌ FAIL | 2026-09-20

**Status remains:** draft
**Failed criteria:**

- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: not-applicable PLAN reason is invalid: Reason cites forbidden engineering evidence: harness checks
  **Required action:** record one visible substantive **Reason:** field

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `c81dd4ff7569` · base `origin/develop@c81dd4ff7569` · document `.agents/spec-docs/draft/PERF-2423-reuse-local-review-context-and-inspect-only-repair-deltas.md` blob `8ae449f69f36` (modified)

### [GATE-PLAN] — ✅ PASS | 2026-09-20

**Status upgrade:** draft → approved

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: PERF` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (1 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 487 chars, 4 sentences
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: `## Prior Art Research` section present
- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare : `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — All 4 checklist items are `[x]`: 5/5 checklist items `[x]`
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: Sibling scan `[x]` with an explicit N/A reason
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
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` present with 2 prior entries (none from a later gate)
- GATE-WRITE — No `## Status` or `## Classification` sections in the body (these are frontmatter fields): no `## Status` / `## Classification` body sections
- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <3)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (701ece52e3d9) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/PERF-2423-reuse-local-review-context-and-inspect-only-repair-deltas.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/PERF-2423-reuse-local-review-context-and-inspect-only-repair-deltas.md`, whose basename is the spec's
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `c81dd4ff7569` · base `origin/develop@c81dd4ff7569` · document `.agents/spec-docs/draft/PERF-2423-reuse-local-review-context-and-inspect-only-repair-deltas.md` blob `bedce4099754` (modified)
