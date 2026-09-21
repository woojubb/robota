---
status: done
type: INFRA
tags: [infra]
lane: L1
---

# GATE-2525: scope delivery closeout receipts to the current pull request

Paired with `.agents/tasks/GATE-2525-scope-delivery-closeout-receipts-to-the-current-pull-request.md`. Arising from [issue #2525](https://github.com/woojubb/robota/issues/2525).

## Problem

The required `--audit-closeout` command for PR #2788 returned
`{"ok":false,"reason":"ambiguous-completion"}` even though comment 5755797863 is the one exact,
trusted, immutable receipt for that PR and issue #2525 remains correctly open. The selector examined
every trusted `DELIVERY_COMPLETION_RECORD` on the shared umbrella Issue before binding a receipt to the
current PR, so the valid earlier records for PRs #2781 and #2785 made every later partial-delivery audit
ambiguous. This recurs whenever more than one child lands against the same umbrella Issue.

## Prior Art Research

Waived: internal fix with no contract change; the remedy is the repository's own precedent

## Architecture Review

### Affected Scope

- `post-merge delivery audit`

### Alternatives Considered

1. Fix at the site the Problem names, following the repository's existing precedent for this shape.
   - Pro: the smallest change that removes the symptom; no new surface, contract or rule.
   - Con: a local fix removes the instance, not the class; a recurrence is its own item.
2. Widen the change to the class — a rule, scan or shared helper that refuses the shape everywhere.
   - Pro: removes the class rather than the instance.
   - Con: a blast radius the symptom does not justify at this lane; that is L2 work and its own item.

### Decision

**Alternative 1.** Filter trusted completion receipts by the live PR number before applying the existing
missing/ambiguous uniqueness rule. This admits legitimate receipts for other PRs without weakening the
refusal on zero or multiple receipts for the PR being audited.

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

Extend the existing trusted-receipt selector with a narrow predicate and use it only for delivery
completion receipts, selecting `receipt.prNumber === pr.number` before uniqueness is evaluated. Keep
merge-decision selection unchanged because those comments already live on one PR. Add one regression for
different-PR receipts on the same Issue and one refusal assertion for duplicate receipts bound to the
current PR.

## Affected Files

- `scripts/harness/post-findings-authorization.mjs`
- `scripts/harness/__tests__/post-findings-authorization.test.mjs`
- `.agents/tasks/GATE-2525-scope-delivery-closeout-receipts-to-the-current-pull-request.md`
- `.agents/spec-docs/**/GATE-2525-scope-delivery-closeout-receipts-to-the-current-pull-request.md`

## Completion Criteria

- [x] TC-01: `pnpm exec vitest run scripts/harness/__tests__/post-findings-authorization.test.mjs -t "selects the current PR completion from repeated umbrella deliveries"` → exits 0, and exits 1 with the fix reverted
- [x] TC-02: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` → exits 0
- [x] TC-03: `pnpm exec vitest run scripts/harness/__tests__/post-findings-authorization.test.mjs` → exits 0 on the whole file and retains the same-PR duplicate refusal

## Test Plan

| TC-ID | Test Type | Tool / Approach                                                                                                                                | Notes                                                                                            |
| ----- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| TC-01 | Unit      | `scripts/harness/__tests__/post-findings-authorization.test.mjs` / `it('selects the current PR completion from repeated umbrella deliveries')` | RED before the selector is PR-scoped; GREEN after                                                |
| TC-02 | Suite     | `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts`                                            | Regression — the affected set, not the full suite                                                |
| TC-03 | Unit      | `scripts/harness/__tests__/post-findings-authorization.test.mjs` / `describe('single-pass remote closeout receipts')`                          | Whole-file pass, including `it('still refuses multiple completion receipts for the current PR')` |

## User Execution Test Scenarios

Not applicable.

**Reason:** This changes only the repository's internal post-merge evidence selector; it does not alter
or expose any Robota CLI, SDK, TUI, browser, protocol, or other runnable product behavior.

## Tasks

- [x] `.agents/tasks/completed/GATE-2525-scope-delivery-closeout-receipts-to-the-current-pull-request.md` — done

## Evidence Log

### [GATE-APPROVAL] — ✅ PASS | 2026-09-21

**Status upgrade:** draft → approved
**Approval route:** `CLASS`
**Class:** `LANE-L0-L1`
**Instruction (verbatim):** "좋아 모두 승인한다. 빠르게 적용해줘. 필요하면 병렬 에이전트와 workflow를 적극 적용해줘"
**Given:** 2026-09-21, this conversation
**Evidence condition met:** `node scripts/harness/scan-lane-declaration.mjs --changed <2 path(s)> --diff-file <diff vs origin/develop> --trailers-file <Lane: L1>` over 2 changed path(s) — committed and working-tree changes vs origin/develop (merge base 9019499a5f9e) → exit 0, `lane-declaration summary: violations=0 result=PASS` (Lane L1 (spec-doc frontmatter .agents/spec-docs/draft/GATE-2525-scope-delivery-closeout-receipts-to-the-current-pull-request.md) is at or above the floor L0) — note: node scripts/harness/scan-lane-declaration.mjs over the two staged GATE-2525 Task/spec paths with their staged diff and Lane: L1 trailer file -> exit 0; examined 2 changed paths; Lane L1 is at or above floor L0; violations=0 result=PASS
**Review fingerprint:** 7171f52008eb (review 2ee5fe2c, type/tags 2433998c)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <2)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (7171f52008eb) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `9019499a5f9e` · base `origin/develop@9019499a5f9e` · document `.agents/spec-docs/draft/GATE-2525-scope-delivery-closeout-receipts-to-the-current-pull-request.md` blob `01b558c829a2` (modified)

### [GATE-PLAN] — ✅ PASS | 2026-09-21

**Status upgrade:** draft → approved

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: INFRA` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (1 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 558 chars, 3 sentences
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
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` present with 1 prior entry (none from a later gate)
- GATE-WRITE — No `## Status` or `## Classification` sections in the body (these are frontmatter fields): no `## Status` / `## Classification` body sections
- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <2)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (7171f52008eb) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/GATE-2525-scope-delivery-closeout-receipts-to-the-current-pull-request.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/GATE-2525-scope-delivery-closeout-receipts-to-the-current-pull-request.md`, whose basename is the spec's
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `9019499a5f9e` · base `origin/develop@9019499a5f9e` · document `.agents/spec-docs/draft/GATE-2525-scope-delivery-closeout-receipts-to-the-current-pull-request.md` blob `c6da99996bd9` (modified)

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-09-21

**Command:** `pnpm exec vitest run scripts/harness/__tests__/post-findings-authorization.test.mjs -t 'selects the current PR completion from repeated umbrella deliveries'`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
2:33:23 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-2

 ✓ scripts/harness/__tests__/post-findings-authorization.test.mjs (35 tests | 34 skipped) 2ms

 Test Files  1 passed (1)
      Tests  1 passed | 34 skipped (35)
   Start at  14:33:23
   Duration  179ms (transform 25ms, setup 0ms, collect 31ms, tests 2ms, environment 0ms, prepare 27ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `4ae0cab610eb` · base `origin/develop@9019499a5f9e` · document `.agents/spec-docs/todo/GATE-2525-scope-delivery-closeout-receipts-to-the-current-pull-request.md` blob `ee53590029ef` (tracked)

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-09-21

**Command:** `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts`
**Exit:** 0
**Output:** (last 10 of 192 line(s))

```
Diagnostic report v1: 2 result(s), 2 non-clean.
ERROR harness.scan-finding.scan-c36-c2t-c2u-c2t-c36-c2t-c32-c2r-c2t-c19-c2z-c2x-c32-c2s-c19-c35-c39-c2p-c30-c2x-c2u-c2x-c2t-c2s [finding] scan:reference-kind-qualified
  evidence: Scan reference-kind-qualified exited with status 1.
  recommendation: Inspect the reference-kind-qualified scan output above.
ERROR harness.scan-finding.scan-c38-c2p-c37-c2z-c19-c31-c2t-c36-c2v-c2t-c2s-c19-c2r-c2x-c38-c2p-c38-c2x-c33-c32 [finding] scan:task-merged-citation
  evidence: Scan task-merged-citation exited with status 1.
  recommendation: Inspect the task-merged-citation scan output above.

60 scans passed, 1 skipped, 2 advisory failure(s) tolerated (pr context), 2 non-clean diagnostic result(s) reported (63 declared what they examined)
scan receipt NOT written: 2 advisory failure(s) were tolerated (reference-kind-qualified, task-merged-citation), and a receipt must not certify them.
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `4ae0cab610eb` · base `origin/develop@9019499a5f9e` · document `.agents/spec-docs/todo/GATE-2525-scope-delivery-closeout-receipts-to-the-current-pull-request.md` blob `a1751eb9157b` (modified)

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-09-21

**Command:** `pnpm exec vitest run scripts/harness/__tests__/post-findings-authorization.test.mjs`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
2:33:36 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-2

 ✓ scripts/harness/__tests__/post-findings-authorization.test.mjs (35 tests) 8ms

 Test Files  1 passed (1)
      Tests  35 passed (35)
   Start at  14:33:36
   Duration  177ms (transform 24ms, setup 0ms, collect 29ms, tests 8ms, environment 0ms, prepare 27ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `4ae0cab610eb` · base `origin/develop@9019499a5f9e` · document `.agents/spec-docs/todo/GATE-2525-scope-delivery-closeout-receipts-to-the-current-pull-request.md` blob `582dda310668` (modified)

### [GATE-DONE] — ✅ PASS | 2026-09-21

**Status upgrade:** approved → done

**Ordering check:** PASS — `[GATE-PLAN] — ✅ PASS | 2026-09-21` is recorded above with
`**Status upgrade:** draft → approved`; its target equals the document's current `status: approved`, and
the document is in `.agents/spec-docs/todo/`, the lifecycle folder for that status. This satisfies the
catalogue's `recorded-pass` rule for `GATE-DONE → GATE-PLAN`.

**Mechanical recheck:**
`node scripts/harness/gate.mjs judge --gate DONE --doc .agents/spec-docs/todo/GATE-2525-scope-delivery-closeout-receipts-to-the-current-pull-request.md --lane L1 --dry-run --verify-cmd 'node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts' --verify-cmd 'pnpm exec vitest run scripts/harness/__tests__/post-findings-authorization.test.mjs scripts/harness/__tests__/post-merge-delivery-records.test.mjs'`
exited 2 with `13 criteria judged — 11 PASS, 0 FAIL, 2 PENDING-GUARDIAN`; no entry was written by
the evaluator. The only pending criteria are the two Task Plan checks judged directly below.

- GATE-VERIFY — Every item in the `## Plan` section of `.agents/tasks/<ID>.md` is marked complete
  (`[x]`): **PASS (guardian).** The paired Task's `## Plan` contains exactly four items, and all four
  are `[x]`: the repeated-umbrella regression, PR-scoped selection, preservation of refusal cases, and
  focused-suite plus affected-scan verification.
- GATE-VERIFY — No Plan item is blocked or pending: **PASS (guardian).** Direct inspection of the
  complete four-item `## Plan` finds no unchecked item and no blocked or pending marker.
- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): **PASS (mechanical).** The supplied
  build-shaped command
  `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts`
  exited 0; its result was `61 scans passed, 1 skipped, 2 advisory failure(s) tolerated (pr context)`.
  The advisories were the pre-existing `reference-kind-qualified` and `task-merged-citation` findings,
  and the command's PR-context contract returned success.
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): **PASS (mechanical).** The supplied
  test-shaped command
  `pnpm exec vitest run scripts/harness/__tests__/post-findings-authorization.test.mjs scripts/harness/__tests__/post-merge-delivery-records.test.mjs`
  exited 0 with `Test Files 2 passed (2)` and `Tests 62 passed (62)`.
- GATE-COMPLETE — The checkbox is checked (`[x]`): **PASS (mechanical).** All 3 Completion Criteria
  checkboxes are `[x]`.
- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists with the exact verification
  command/action, observed result, and exit code: **PASS (mechanical).** The entries above cover TC-01,
  TC-02, and TC-03; each records its command, exit 0, and captured output.
- GATE-COMPLETE — Each Test Plan row records a test reference or an explicit skip reason:
  **PASS (mechanical).** TC-01 names
  `scripts/harness/__tests__/post-findings-authorization.test.mjs` and the exact repeated-delivery test;
  TC-02 names the affected-scan script and exact command; TC-03 names the same unit-test file, its
  `single-pass remote closeout receipts` describe block, and the exact same-PR duplicate-refusal test.
- GATE-COMPLETE — No TC-N is silently unaddressed: **PASS (mechanical).** All 3 Test Plan rows contain
  the corresponding durable test or scan reference.
- GATE-COMPLETE — Spec document `## Completion Criteria` checkboxes are all `[x]`:
  **PASS (mechanical).** TC-01, TC-02, and TC-03 are checked.
- GATE-COMPLETE — `## Test Plan` is updated with test references or skip reasons for all TC-N rows:
  **PASS (mechanical).** All 3 rows carry concrete repository paths and named test/command evidence.
- GATE-COMPLETE — The spec's `## Tasks` section names the exact active task path under
  `.agents/tasks/`: **PASS (mechanical).** It names
  `.agents/tasks/GATE-2525-scope-delivery-closeout-receipts-to-the-current-pull-request.md`, and that
  file exists.
- GATE-COMPLETE — That active task exists and is completion-ready: all tasks are `[x]`, with no pending
  or blocked item: **PASS (mechanical).** The existing Task has 4/4 Plan items checked, with no pending
  or blocked marker.

**Verdict reason:** The required prior gate and input state are valid; both guardian-owned Plan criteria
and all 11 mechanically evaluated criteria pass.

**Judged by:** `backlog-gate-guard` (2 `PENDING-GUARDIAN` Plan criteria) + `gate.mjs` mechanical evaluator
(ordering and 10 remaining gate criteria, re-run with both exact verification commands)
**Judged at:** HEAD `4ae0cab610eb` · base `origin/develop@9019499a5f9e` · document
`.agents/spec-docs/todo/GATE-2525-scope-delivery-closeout-receipts-to-the-current-pull-request.md`
pre-entry blob `537147e6399417bebdb13b3f3efde72e355dbebd` (modified) · paired Task blob
`2af603c831172798b8b48f2b1d81437d50eaac9a` (modified)
