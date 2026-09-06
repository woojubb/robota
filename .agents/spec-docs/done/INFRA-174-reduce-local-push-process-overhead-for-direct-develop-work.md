---
status: done
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

- [x] `.agents/tasks/completed/INFRA-174-reduce-local-push-process-overhead-for-direct-develop-work.md` — done

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

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-09-06

**Command:** `pnpm exec vitest run scripts/harness/__tests__/pre-push-sequence.test.mjs scripts/harness/__tests__/workspace-affected.test.mjs scripts/harness/__tests__/work-run-validation.test.mjs`
**Exit:** 0
**Output:** (last 10 of 96 line(s))

```
   ✓ work-run validation > rejects a mismatched ownerFingerprint identity field  410ms
   ✓ work-run validation > validates the newest closure while retaining immutable prior receipts  621ms
   ✓ work-run validation > rejects a prior receipt path that was modified after its one addition  353ms
   ✓ work-run validation > rejects a foreign receipt injected into the validated topic range  463ms
   ✓ work-run validation > rejects the commit-count sentinel before materializing an unbounded range  438ms

 Test Files  3 passed (3)
      Tests  109 passed (109)
   Start at  23:01:09
   Duration  27.48s (transform 280ms, setup 0ms, collect 540ms, tests 27.71s, environment 0ms, prepare 112ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `fbcb9ef80b6a` · base `origin/develop@aff91a876cd7` · document `.agents/spec-docs/todo/INFRA-174-reduce-local-push-process-overhead-for-direct-develop-work.md` blob `a31c5a461c11` (tracked)

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-09-06

**Command:** `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts --skip work-run-measurement`
**Exit:** 0
**Output:** (last 10 of 73 line(s))

```
✓ test-module-mocks
✓ backlog-placement
✓ llms-txt
✓ orphan-exports
✓ rule-statement-floor
✓ test-plans
✓ file-size
✓ doc-folder-status
61 scans passed, 1 skipped (62 declared what they examined)
scan receipt written: an unchanged tree will not be re-scanned.
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `fbcb9ef80b6a` · base `origin/develop@aff91a876cd7` · document `.agents/spec-docs/todo/INFRA-174-reduce-local-push-process-overhead-for-direct-develop-work.md` blob `063640a257dd` (modified)

### [GATE-DONE] — ✅ PASS | 2026-09-06 (backlog-gate-guard)

**Status upgrade:** approved → done

**Ordering check:** GATE-DONE's prior gate is GATE-PLAN (`gate-catalogue.md` § Prior-gate map, `recorded-pass` rule declared for this row). The `[GATE-PLAN] — ✅ PASS | 2026-09-06` entry's `**Status upgrade:** draft → approved` line has `Y = approved`, equal to the document's current `status: approved` — satisfied.

**Mechanical set reproduced independently**, not taken on the caller's reported summary alone — `node scripts/harness/gate.mjs judge --gate DONE --doc .agents/spec-docs/todo/INFRA-174-reduce-local-push-process-overhead-for-direct-develop-work.md --lane L1 --dry-run --verify-cmd "pnpm exec vitest run scripts/harness/__tests__/pre-push-sequence.test.mjs scripts/harness/__tests__/workspace-affected.test.mjs scripts/harness/__tests__/work-run-validation.test.mjs" --verify-cmd "node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts --skip work-run-measurement"` at HEAD `fbcb9ef80b6a` → `13 criteria judged — 11 PASS, 0 FAIL, 2 PENDING-GUARDIAN`, exit 2, no entry auto-written (pending is the guardian's to judge and record) — matches the caller's reported counts.

- GATE-VERIFY — Every item in the `## Plan` section of `.agents/tasks/<ID>.md` is marked complete (`[x]`) (`task-plan-items`): **PASS (guardian).** Read directly: `.agents/tasks/INFRA-174-reduce-local-push-process-overhead-for-direct-develop-work.md` carries no `## Plan` heading at all — its sections are `## Problem`, `## Resolution`, `## Test Plan`, `## User Execution Test Scenarios` (a narrative problem-record shape, not a checkbox-plan Task). The criterion's own named mechanical authority, `scan-task-plan-items.mjs`, defines `planSection()` (`/^## Plan[^\n]*\n.../m`) to return `null` when no `## Plan` heading exists, and its scan loop `continue`s past such a Task without counting it or recording any finding — verified by reading the source directly. Run live: `node scripts/harness/scan-task-plan-items.mjs` → exit 0, `::examined:: 259 Task Plan sections`, `task-plan-items scan passed.` — this Task is correctly absent from the 259 examined sections. `.agents/tasks/README.md` § "Plan Items" confirms `## Plan` is a named, optional checkbox-breakdown section ("holds the work, never its disposition"), not a mandatory Task section — this Task instead records its work as a narrative `## Resolution` (3 numbered items), independently confirmed delivered at HEAD: `git log --oneline -1 -- scripts/harness/pre-push-work-run.mjs scripts/harness/workspace-plan-shapes.mjs` shows commit `fbcb9ef80` "fix(harness): reduce local push process overhead (INFRA-174)", and `grep` confirms `reportMeasurementAdvisory` present in `pre-push-work-run.mjs`'s `runPrePushGate` and `'scripts/harness/'` present in `workspace-plan-shapes.mjs`'s `NO_PACKAGE_PREFIXES`. This reading is also the repository's already-settled one for the identical fact pattern: in the SAME live `judge` run above, the sibling GATE-COMPLETE criterion bound to the identical `allTasksComplete` judgement (`gate-operations.mjs`) PASSED on this same Task with the observed text "carries no checkbox plan (a Task is the problem record, not a breakdown)" — where the harness CAN currently bind the wording, it already reads zero Plan checkboxes as satisfied, not deficient. "Every item … is marked complete" is vacuously true over an empty/absent item set. `gate.mjs`'s `verifyChecks()` reports this specific criterion `PENDING-GUARDIAN` only because its `tasks-complete` id's regex (`/All tasks in \`\.agents\/tasks\/<ID>\.md\` are marked complete/i`) no longer matches the catalogue's current wording from issue #2375 ("Every item in the `## Plan`section … is marked complete") — a stale wording binding, confirmed by reading`gate-operations.mjs`'s `verifyChecks()` directly, not an open question about this Task's content.
- GATE-VERIFY — No Plan item is blocked or pending: **PASS (guardian).** Same absent-`## Plan` fact: there is no Plan item of any kind in this Task, so none can be blocked or pending — vacuously satisfied for the same reason as above. `gate.mjs`'s `no-blocked` id is `PENDING-GUARDIAN` for the identical mechanical cause: its regex `/No tasks are blocked or pending/i` does not match the catalogue's current "No Plan item is blocked or pending" wording — confirmed by reading `gate-operations.mjs` directly.
- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): **PASS (mechanical, reproduced).** `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts --skip work-run-measurement` → exit 0, `61 scans passed, 1 skipped (62 declared what they examined)` — matches the already-recorded `[GATE-COMPLETE: TC-02]` entry above.
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): **PASS (mechanical, reproduced).** `pnpm exec vitest run scripts/harness/__tests__/pre-push-sequence.test.mjs scripts/harness/__tests__/workspace-affected.test.mjs scripts/harness/__tests__/work-run-validation.test.mjs` → exit 0, 109 tests passed — matches the already-recorded `[GATE-COMPLETE: TC-01]` entry above.
- GATE-COMPLETE — The checkbox is checked (`[x]`): **PASS (mechanical, reproduced).** 2/2 TC checkboxes `[x]`.
- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists (command, output, exit code): **PASS (mechanical, reproduced).** Entries exist for TC-01 and TC-02 above.
- GATE-COMPLETE — One of the following is recorded (test written / test skipped with reason); no TC-N silently unaddressed: **PASS (mechanical, reproduced).** Both Test Plan rows (TC-01, TC-02) carry a tool/approach reference.
- GATE-COMPLETE — Spec document `## Completion Criteria` checkboxes are all `[x]`: **PASS (mechanical, reproduced).** 2/2 `[x]`.
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: **PASS (mechanical, reproduced).** Same measurement as above.
- GATE-COMPLETE — The spec's `## Tasks` section names the exact active task path under `.agents/tasks/`: **PASS (mechanical, reproduced).** Names `.agents/tasks/INFRA-174-reduce-local-push-process-overhead-for-direct-develop-work.md`, which exists.
- GATE-COMPLETE — That active task exists and is completion-ready: all tasks are `[x]`, with no pending or blocked item: **PASS (mechanical, reproduced).** Observed: "carries no checkbox plan (a Task is the problem record, not a breakdown)" — the same underlying fact as the two guardian-judged criteria above, judged mechanically here because this id's wording binding is current.

**Note, not a criterion of this gate:** `gate-operations.mjs`'s `verifyChecks()` ids `tasks-complete` and `no-blocked` carry regexes that no longer match GATE-VERIFY's current catalogue wording (post issue #2375's `## Plan`-section scoping), so both always fall to `PENDING-GUARDIAN` regardless of a Task's actual Plan content — the same defect already noted against `.agents/spec-docs/done/HARNESS-102-a-dropped-finding-leaves-no-artifact.md`'s identical GATE-DONE entry today; not fixed here as it is outside this gate's criteria.

**Judged by:** backlog-gate-guard (semantic)
**Judged at:** HEAD `fbcb9ef80b6a85717cdeb2434fbde7604d0a36a8` · base `origin/develop@aff91a876cd74f82616d0d1708cd53480a7dfc63` · document `.agents/spec-docs/todo/INFRA-174-reduce-local-push-process-overhead-for-direct-develop-work.md` blob `2856c4e10efa6be3d37ebf44e382b18faec22e73` (modified)
