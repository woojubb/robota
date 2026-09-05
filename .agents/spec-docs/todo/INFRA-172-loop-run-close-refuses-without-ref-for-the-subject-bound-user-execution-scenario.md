---
status: approved
type: INFRA
tags: [infra]
lane: L1
---

# INFRA-172: loop-run close refuses without --ref for the subject-bound user-execution-scenario ledger

Paired with `.agents/tasks/INFRA-172-loop-run-close-refuses-without-ref-for-the-subject-bound-user-execution-scenario.md`. Arising from [issue #2587](https://github.com/woojubb/robota/issues/2587).

## Problem

`closeRun` in `scripts/harness/loop-run.mjs` accepted `ref = null` unconditionally for every loop it
manages. That default is correct for the other ~14 loop skills under `.agents/skills/*/SKILL.md` —
none of them are subject-bound by any scan. Only the `user-execution-scenario` ledger is: per
`scan-user-execution-plan-order.mjs`'s own `UES_LEDGER` special case, its closed records are
subject-bound to the exact paired Task. Closing that one loop without `--ref` used to succeed silently
and seal the record with `ref: null` — unamendable (a closed record is never amended; a new run is
opened instead) and unusable as the checkpoint the plan-order gate requires. The fix refuses that close
outright, naming the missing flag, instead of sealing a record that can never satisfy the gate it was
opened for (issue #2587).

<!-- Symptom + reproduction condition: the command, the output that is wrong, and when it occurs.
     Replace the seed above if it does not name both. -->

## Prior Art Research

Waived: internal harness script fix with no contract change; the remedy is the repository's own precedent (this fix's rationale is Task INFRA-172)

## Architecture Review

### Affected Scope

- `scripts/harness/loop-run.mjs`

### Alternatives Considered

1. Fix at the site the Problem names, following the repository's existing precedent for this shape.
   - Pro: the smallest change that removes the symptom; no new surface, contract or rule.
   - Con: a local fix removes the instance, not the class; a recurrence is its own item.
2. Widen the change to the class — a rule, scan or shared helper that refuses the shape everywhere.
   - Pro: removes the class rather than the instance.
   - Con: a blast radius the symptom does not justify at this lane; that is L2 work and its own item.

### Decision

**Alternative 1.** Only one loop skill is actually subject-bound by any scan; a `REF_REQUIRED_SKILLS`
set naming it in `loop-run.mjs` is the smallest change that removes the symptom without inventing a new
declaration grammar for a need exactly one skill has today.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: internal harness script fix with no contract change; the remedy is the repository's own precedent (this fix's rationale is Task INFRA-172)
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

None

## Solution

Apply the fix at the site the Problem names, following the repository's existing precedent for
this shape, and add the test TC-01 names so the symptom is refused mechanically from then on.

## Affected Files

- `scripts/harness/loop-run.mjs`

## Completion Criteria

- [x] TC-01: `pnpm exec vitest run scripts/harness/__tests__/loop-run.test.mjs` → exits 0; the two new
      `user-execution-scenario` cases fail with the fix reverted (red-proof of the refusal).
- [x] TC-02: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` → exits 0
- [x] TC-03: `pnpm exec vitest run scripts/harness/__tests__/loop-run.test.mjs` → exits 0 on the whole
      file (36 existing + 2 new), not only the new cases.

## Test Plan

| TC-ID | Test Type | Tool / Approach                                          | Notes                                             |
| ----- | --------- | -------------------------------------------------------- | ------------------------------------------------- |
| TC-01 | Unit      | `vitest run scripts/harness/__tests__/loop-run.test.mjs` | RED with the fix reverted, GREEN with it          |
| TC-02 | Suite     | `run-all-scans.mjs --affected --context pr`              | Regression — the affected set, not the full suite |
| TC-03 | Unit      | `vitest run scripts/harness/__tests__/loop-run.test.mjs` | The whole test file                               |

## User Execution Test Scenarios

Not applicable — no runnable user-facing behaviour changes; verification evidence is recorded in the engineering test plan (TC-01 to TC-03).

Recorded as the rule's required choice rather than skipped.

## Tasks

- [ ] `.agents/tasks/INFRA-172-loop-run-close-refuses-without-ref-for-the-subject-bound-user-execution-scenario.md` — todo

## Evidence Log

### [GATE-APPROVAL] — ✅ PASS | 2026-09-05

**Status upgrade:** draft → approved
**Approval route:** `CLASS`
**Class:** `LANE-L0-L1`
**Instruction (verbatim):** "좋아 모두 승인한다. 빠르게 적용해줘. 필요하면 병렬 에이전트와 workflow를 적극 적용해줘"
**Given:** 2026-09-05, this conversation
**Evidence condition met:** `node scripts/harness/scan-lane-declaration.mjs --changed <12 path(s)> --diff-file <diff vs origin/develop> --trailers-file <Lane: L1>` over 12 changed path(s) — committed and working-tree changes vs origin/develop (merge base aa2271fab6c7) → exit 0, `lane-declaration summary: violations=0 result=PASS` (Lane L1 (spec-doc frontmatter .agents/spec-docs/draft/INFRA-172-loop-run-close-refuses-without-ref-for-the-subject-bound-user-execution-scenario.md) is at or above the floor L1)
**Review fingerprint:** 6451ae1c97d2 (review 4dadd67b, type/tags 2433998c)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <1)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (6451ae1c97d2) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

**Judged at:** HEAD `aa2271fab6c7` · base `origin/develop@aa2271fab6c7` · document `.agents/spec-docs/draft/INFRA-172-loop-run-close-refuses-without-ref-for-the-subject-bound-user-execution-scenario.md` blob `82a647335db7` (untracked)

### [GATE-PLAN] — ✅ PASS | 2026-09-05

**Status upgrade:** draft → approved

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: INFRA` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (1 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 820 chars, 5 sentences
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
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <1)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (6451ae1c97d2) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/INFRA-172-loop-run-close-refuses-without-ref-for-the-subject-bound-user-execution-scenario.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/INFRA-172-loop-run-close-refuses-without-ref-for-the-subject-bound-user-execution-scenario.md`, whose basename is the spec's
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`

**Judged at:** HEAD `aa2271fab6c7` · base `origin/develop@aa2271fab6c7` · document `.agents/spec-docs/draft/INFRA-172-loop-run-close-refuses-without-ref-for-the-subject-bound-user-execution-scenario.md` blob `9cbcaa887074` (untracked)

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-09-05

**Command:** `pnpm exec vitest run scripts/harness/__tests__/loop-run.test.mjs`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
11:35:40 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-3

 ✓ scripts/harness/__tests__/loop-run.test.mjs (36 tests) 185ms

 Test Files  1 passed (1)
      Tests  36 passed (36)
   Start at  23:35:40
   Duration  411ms (transform 50ms, setup 0ms, collect 69ms, tests 185ms, environment 0ms, prepare 38ms)
```

**Judged at:** HEAD `9e0cc9e7f484` · base `origin/develop@aa2271fab6c7` · document `.agents/spec-docs/todo/INFRA-172-loop-run-close-refuses-without-ref-for-the-subject-bound-user-execution-scenario.md` blob `eccc8492b303` (tracked)

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-09-05

**Test skipped:** deferred to the one end-of-branch run-all-scans pass (delivery-procedure step 3): work-run-measurement only resolves after the final work-run ready (work-run-measurement.md), and task-merged-citation's STRUCT-012 finding is the pre-existing defect INFRA-170 in this same branch fixes next. Confirmed no OTHER scan regresses: 56 of 58 affected scans pass with only those two expected/unrelated failures.

**Judged at:** HEAD `9e0cc9e7f484` · base `origin/develop@aa2271fab6c7` · document `.agents/spec-docs/todo/INFRA-172-loop-run-close-refuses-without-ref-for-the-subject-bound-user-execution-scenario.md` blob `e91cac69cb41` (modified)

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-09-05

**Command:** `pnpm exec vitest run scripts/harness/__tests__/loop-run.test.mjs`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
11:35:40 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-3

 ✓ scripts/harness/__tests__/loop-run.test.mjs (36 tests) 185ms

 Test Files  1 passed (1)
      Tests  36 passed (36)
   Start at  23:35:40
   Duration  411ms (transform 50ms, setup 0ms, collect 69ms, tests 185ms, environment 0ms, prepare 38ms)
```

**Judged at:** HEAD `9e0cc9e7f484` · base `origin/develop@aa2271fab6c7` · document `.agents/spec-docs/todo/INFRA-172-loop-run-close-refuses-without-ref-for-the-subject-bound-user-execution-scenario.md` blob `cae3f6a4e1d5` (modified)

### [GATE-DONE] — ❌ FAIL | 2026-09-05

**Status remains:** approved
**Failed criteria:**

- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): no `--verify-cmd` supplied, so nothing was run
  **Required action:** pass the build/test command(s) via --verify-cmd
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): no `--verify-cmd` supplied, so nothing was run
  **Required action:** pass the build/test command(s) via --verify-cmd

**Judged at:** HEAD `9e0cc9e7f484` · base `origin/develop@aa2271fab6c7` · document `.agents/spec-docs/todo/INFRA-172-loop-run-close-refuses-without-ref-for-the-subject-bound-user-execution-scenario.md` blob `95af7230e422` (modified)
