---
status: approved
type: INFRA
tags: [harness, cli]
lane: L1
---

# INFRA-174: reduce local push process overhead for direct-develop work

## Problem

Two independent sessions doing ordinary, low-risk work each lost a large share of their session to
local harness friction unrelated to the correctness of their change. `work-run-measurement`
crashes the push with an uncaught exception whose receipt/trailer lifecycle assumes a claim→PR
flow, which a maintainer-approved direct-to-`develop` push does not have — `.agents/learn.md`'s
`LRN-work-run-measurement-direct-push-gap` recorded this from the first session; the second
session's diagnosis (`/tmp/robota-issues/PROCESS-OVERHEAD-REPORT.md`) hit the identical failure
independently. Separately, an ordinary `scripts/harness/*.mjs` change resolves to neither a package
owner nor a no-package path in the workspace-affected planner, falls through to
`unknown changed path`, and forces a full-workspace build/test/typecheck for a change no package
graph reaches.

## Prior Art Research

Waived: this is a repository-local harness/CI tooling policy change with no external product or
protocol behavior to research.

## Architecture Review

### Affected Scope

- `scripts/harness/pre-push-work-run.mjs`
- `scripts/harness/pre-push-runtime.mjs`
- `scripts/harness/workspace-plan-shapes.mjs`
- `scripts/harness/file-size-baseline.json`

### Alternatives Considered

1. Leave `work-run-measurement` blocking and only improve its error message.
   - Pro: smallest diff; keeps the gate's current strictness.
   - Con: does not fix the actual failure mode — a correct, reviewed push is still refused over the
     work-run tracker's own claim/reopen/ready bookkeeping, which is what cost both sessions real
     time even after the message was readable.
2. Make `work-run-measurement` advisory (report, do not block) at push time, matching what CI's own
   `scans-full.yml` already does for the same scan, and register `scripts/harness/` as a
   no-package path in the workspace-affected planner.
   - Pro: removes the actual blocking failure mode at its source; brings local push parity with
     what CI already treats as non-blocking; the workspace-affected fix removes a full-revalidation
     tax that no package graph justifies.
   - Con: a genuinely broken work-run receipt no longer blocks a push — accepted, because the
     receipt measures the work-run's own lifecycle tracking, not the pushed code's correctness,
     and the advisory message still surfaces the problem for a later fix.

### Decision

Alternative 2. A readable message alone leaves the actual blocking behavior in place, which is what
consumed both sessions' time; the receipt/trailer chain's correctness is not a property of the
code being pushed, so it should not be able to refuse an otherwise-clean push.

**Delivery mode:** `single`

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: repository harness-tooling/CI policy, not a command family
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and no
      layer or product-family reclassification.

## Fallback & Degradation Declaration

None

## Solution

1. `pre-push-work-run.mjs`: wrap the `validateWorkRunMeasurement` call in `runPrePushGate` so a
   thrown error or a `{ ok: false }` verdict is reported via a new `reportMeasurementAdvisory` step
   instead of throwing; execution continues to receipt reuse and verification as normal.
2. `pre-push-runtime.mjs`: add the `reportMeasurementAdvisory` step, printing the reason and where
   to inspect/repair it later.
3. `workspace-plan-shapes.mjs`: add `scripts/harness/` to `NO_PACKAGE_PREFIXES`; the more specific
   scope-mapping files under it remain in `GLOBAL_PREFIXES`, checked first, so they are unaffected.
4. `file-size-baseline.json`: regenerate to close the pre-existing `allocate-work-item-id.mjs` drift.

## Affected Files

- `scripts/harness/pre-push-work-run.mjs`
- `scripts/harness/pre-push-runtime.mjs`
- `scripts/harness/workspace-plan-shapes.mjs`
- `scripts/harness/file-size-baseline.json`
- `scripts/harness/__tests__/pre-push-sequence.test.mjs`
- `scripts/harness/__tests__/workspace-affected.test.mjs`

## Completion Criteria

- [x] TC-01: `pnpm exec vitest run scripts/harness/__tests__/pre-push-sequence.test.mjs scripts/harness/__tests__/workspace-affected.test.mjs scripts/harness/__tests__/work-run-validation.test.mjs` → exits 0
- [x] TC-02: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts --skip work-run-measurement` → exits 0

## Test Plan

| TC-ID | Test Type | Tool / Approach                                      | Notes                                                                           |
| ----- | --------- | ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| TC-01 | Unit      | `pnpm exec vitest run` on the three named test files | Covers the advisory step order and the workspace-affected no-package resolution |
| TC-02 | Suite     | `run-all-scans.mjs --affected --context pr`          | Regression — the affected set, not the full suite                               |

## User Execution Test Scenarios

Not applicable.

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This changes internal harness/CI tooling (local pre-push gate behavior and
workspace-affected scope mapping); it has no end-user runtime surface, CLI behavior, SDK contract,
or product-facing interaction to execute.

## Tasks

- [ ] `.agents/tasks/INFRA-174-reduce-local-push-process-overhead-for-direct-develop-work.md` — todo

## Evidence Log

### [GATE-APPROVAL] — ✅ PASS | 2026-09-06

**Status upgrade:** draft → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "지금 강제 훅들이 우회가 안된다는 문제가 가장 커. 우회 하라는게 아니라. 강제 훅들이 너무 촘촘히 되어있는데 필수 아닌 것들 다 들어낼거야"
**Given:** 2026-09-06, this conversation
**Review fingerprint:** a6ed73ff8f53 (review 13465095, type/tags 79e13179)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-06, this conversation
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (a6ed73ff8f53) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `aff91a876cd7` · base `origin/develop@aff91a876cd7` · document `.agents/spec-docs/draft/INFRA-174-reduce-local-push-process-overhead-for-direct-develop-work.md` blob `5ef0e282703d` (untracked)

### [GATE-PLAN] — ✅ PASS | 2026-09-06

**Status upgrade:** draft → approved

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: INFRA` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (2 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 861 chars, 3 sentences
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
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (a6ed73ff8f53) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/INFRA-174-reduce-local-push-process-overhead-for-direct-develop-work.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/INFRA-174-reduce-local-push-process-overhead-for-direct-develop-work.md`, whose basename is the spec's
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `aff91a876cd7` · base `origin/develop@aff91a876cd7` · document `.agents/spec-docs/draft/INFRA-174-reduce-local-push-process-overhead-for-direct-develop-work.md` blob `3cb929aa2b80` (untracked)
