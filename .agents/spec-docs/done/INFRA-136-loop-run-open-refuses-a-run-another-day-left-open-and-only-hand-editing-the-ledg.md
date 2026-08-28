---
status: done
type: RULE
tags: [infra]
lane: L1
---

# INFRA-136: loop-run open closes a run another day left open

Paired with `.agents/tasks/INFRA-136-loop-run-open-refuses-a-run-another-day-left-open-and-only-hand-editing-the-ledg.md`. Arising from [issue #2406](https://github.com/woojubb/robota/issues/2406).

## Problem

`node scripts/harness/loop-run.mjs open --loop <skill>` refuses to open a run while any earlier run of
that skill is still OPEN, and the refusal names no way past it. When the open run was left by an
earlier day's session — the common case after a session ends mid-loop — the only way to open the
next run has been to hand-edit `.agents/loop-runs/<skill>.jsonl`, which is exactly the amendment the
ledger exists to forbid. `open` should close a run opened on an earlier UTC calendar day as
`abandoned` with `ref: "superseded by <new run id>"`, print one line saying so, then open the new run;
a run opened the same UTC day is still refused exactly as today.

## Prior Art Research

Waived: internal fix with no contract change; the remedy is the repository's own precedent

## Architecture Review

### Affected Scope

- `scripts/harness`

### Alternatives Considered

1. Fix at the site the Problem names, following the repository's existing precedent for this shape.
   - Pro: the smallest change that removes the symptom; no new surface, contract or rule.
   - Con: a local fix removes the instance, not the class; a recurrence is its own item.
2. Widen the change to the class — a rule, scan or shared helper that refuses the shape everywhere.
   - Pro: removes the class rather than the instance.
   - Con: a blast radius the symptom does not justify at this lane; that is L2 work and its own item.

### Decision

**Alternative 1.** `openRun` closes an OPEN run whose `opened` UTC calendar day is earlier than now as `abandoned` with `ref: "superseded by <new run id>"` through the same sealed-write path `closeRun` uses, then appends the new run; a same-day OPEN run is still refused, because two runs of one session cannot be told apart afterwards while a day-old one is a dropped session by construction.

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

Apply the fix at the site the Problem names, following the repository's existing precedent for
this shape, and add the test TC-01 names so the symptom is refused mechanically from then on.

## Affected Files

- `scripts/harness/loop-run.mjs`
- `scripts/harness/__tests__/loop-run.test.mjs`

## Completion Criteria

- [x] TC-01: `pnpm exec vitest run scripts/harness/__tests__/loop-run.test.mjs` → exits 0 (the earlier-day OPEN run is closed `abandoned` with `ref: "superseded by <new run id>"`, the same-day OPEN run still throws `already has run`, and the CLI prints one superseded line), and exits 1 with the fix reverted
- [x] TC-02: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` → exits 0
- [x] TC-03: `node scripts/harness/scan-loop-run-records.mjs` → exits 0 (the ledger reader accepts the `abandoned` entries `open` now writes)

## Test Plan

| TC-ID | Test Type | Tool / Approach                                                                                     | Notes                                                                                                                |
| ----- | --------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| TC-01 | Unit      | `pnpm exec vitest run scripts/harness/__tests__/loop-run.test.mjs`                                  | RED with the fix reverted, GREEN with it                                                                             |
| TC-02 | Suite     | `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` | Regression                                                                                                           |
| TC-03 | Scan      | `node scripts/harness/scan-loop-run-records.mjs`                                                    | Ledger reader accepts the new entries; reader contract in `scripts/harness/__tests__/scan-loop-run-records.test.mjs` |

## User Execution Test Scenarios

Not applicable — no runnable user-facing behaviour changes; verification evidence is recorded in the engineering test plan (TC-01 to TC-03).

Recorded as the rule's required choice rather than skipped.

## Tasks

- [x] `.agents/tasks/completed/INFRA-136-loop-run-open-refuses-a-run-another-day-left-open-and-only-hand-editing-the-ledg.md` — done

## Evidence Log

### [GATE-APPROVAL] — ✅ PASS | 2026-08-28

**Status upgrade:** draft → approved
**Approval route:** `CLASS`
**Class:** `LANE-L0-L1`
**Instruction (verbatim):** "좋아 모두 승인한다. 빠르게 적용해줘. 필요하면 병렬 에이전트와 workflow를 적극 적용해줘"
**Given:** 2026-08-28, this conversation
**Evidence condition met:** `node scripts/harness/scan-lane-declaration.mjs --changed <2 path(s)> --diff-file <diff vs feat/proc-016-pipeline-lanes> --trailers-file <Lane: L1>` over 2 changed path(s) — committed and working-tree changes vs feat/proc-016-pipeline-lanes (merge base 513d1305e288) → exit 0, `lane-declaration summary: violations=0 result=PASS` (Lane L1 (spec-doc frontmatter .agents/spec-docs/draft/INFRA-136-loop-run-open-refuses-a-run-another-day-left-open-and-only-hand-editing-the-ledg.md) is at or above the floor L0)
**Review fingerprint:** 621784faafc0 (review 00026808, type/tags 6efb9a42)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <2)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (621784faafc0) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

### [GATE-PLAN] — ✅ PASS | 2026-08-28

**Status upgrade:** draft → approved

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: RULE` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (1 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 657 chars, 3 sentences
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
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (621784faafc0) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/INFRA-136-loop-run-open-refuses-a-run-another-day-left-open-and-only-hand-editing-the-ledg.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/INFRA-136-loop-run-open-refuses-a-run-another-day-left-open-and-only-hand-editing-the-ledg.md`, whose basename is the spec's
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-08-28

**Command:** `pnpm exec vitest run scripts/harness/__tests__/loop-run.test.mjs (preceded by the same run with the fix reverted: 2 failed | 25 passed)`
**Exit:** 0
**Output:** (last 10 of 21 line(s))

```
9:16:01 AM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /tmp/claude-1000/-home-ubunutu-dev-robota-2/3e0c1f6e-bce9-4f8c-8a71-199fe78fc73c/scratchpad/wt-l1

 ✓ scripts/harness/__tests__/loop-run.test.mjs (27 tests) 21ms

 Test Files  1 passed (1)
      Tests  27 passed (27)
   Start at  09:16:01
   Duration  276ms (transform 56ms, setup 0ms, collect 70ms, tests 21ms, environment 0ms, prepare 43ms)
```

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-08-28

**Command:** `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts`
**Exit:** 0
**Output:** (last 10 of 69 line(s))

```
✓ orphan-exports
✓ rule-statement-floor
✓ test-plans
✓ doc-folder-status

⚑ 1 advisory finding(s) — NOT failures. The verdict below is unaffected.
⚑ progress-report-quantification: progress-report quantification examined 0 transcript(s) — no session transcript for this workspace at /home/ubunutu/.claude/projects/-tmp-claude-1000--home-ubunutu-dev-robota-2-3e0c1f6e-bce9-4f8c-8a71-199fe78fc73c-scratchpad-wt-l1; the agent-narrative channel does not exist on this host (e.g. CI or a fresh checkout), so nothing was judged.

53 scans passed, 2 skipped (38 declared what they examined)
scan receipt written: an unchanged tree will not be re-scanned.
```

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-08-28

**Command:** `node scripts/harness/scan-loop-run-records.mjs`
**Exit:** 0
**Output:** (last 2 of 2 line(s))

```
::examined:: 70 loop-run ledger entries
loop-run-records scan passed (70 entry(ies) examined across 11 ledger(s)). It judges the records that EXIST — a run that was never opened leaves no line, and nothing over the tree can see it.
```

### [GATE-DONE] — ❌ FAIL | 2026-08-28

**Status remains:** approved
**Failed criteria:**

- GATE-VERIFY — All tasks in `.agents/tasks/<ID>.md` are marked complete (`[x]`): 3/3 task(s) unticked in .agents/tasks/INFRA-136-loop-run-open-refuses-a-run-another-day-left-open-and-only-hand-editing-the-ledg.md: "Failing test: `openRun` on a ledger whose OPEN run"
  **Required action:** complete and tick every task
- GATE-VERIFY — No tasks are blocked or pending: 3 task(s) unticked/blocked/pending: "Failing test: `openRun` on a ledger whose OPEN run"
  **Required action:** resolve or re-plan them
- GATE-COMPLETE — The checkbox is checked (`[x]`): TC-01, TC-02, TC-03 unticked
  **Required action:** verify and tick every TC
- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : TC-03: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: TC-03: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped
- GATE-COMPLETE — Spec document `## Completion Criteria` checkboxes are all `[x]`: TC-01, TC-02, TC-03 unticked
  **Required action:** verify and tick every TC
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: TC-03: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped
- GATE-COMPLETE — That active task exists and is completion-ready: all tasks are `[x]`, with no pending or blocked item: 3/3 task(s) unticked in .agents/tasks/INFRA-136-loop-run-open-refuses-a-run-another-day-left-open-and-only-hand-editing-the-ledg.md: "Failing test: `openRun` on a ledger whose OPEN run"
  **Required action:** complete and tick every task

### [GATE-DONE] — ✅ PASS | 2026-08-28

**Status upgrade:** approved → done

- GATE-DONE — ordering: prior gate GATE-PLAN PASS and status `approved`: [GATE-PLAN] — ✅ PASS | 2026-08-28; status `approved`
- GATE-VERIFY — All tasks in `.agents/tasks/<ID>.md` are marked complete (`[x]`): 3/3 tasks `[x]` in .agents/tasks/INFRA-136-loop-run-open-refuses-a-run-another-day-left-open-and-only-hand-editing-the-ledg.md
- GATE-VERIFY — No tasks are blocked or pending: no unticked, blocked, or pending task
- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): build-shaped `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` → exit 0 ( ⏎ 53 scans passed, 2 skipped (38 declared what they examined) ⏎ scan receipt NOT written: working tree is not clean: M .agents/spec-docs/todo/INFRA-136-loop-run-open-refuses-a-run-another-day-left-open-and-only-hand-editing-the-ledg.md, M .agents/tasks/INFRA-136-loop-run-open-refuses-a-run-another-day-left-open-and-only-hand-editing-the-ledg.md); all 2 supplied commands exit 0
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): test-shaped `pnpm exec vitest run scripts/harness/__tests__/loop-run.test.mjs` → exit 0 ( Duration 276ms (transform 55ms, setup 0ms, collect 69ms, tests 21ms, environment 0ms, prepare 44ms) ⏎ ⏎ 9:17:01 AM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.); all 2 supplied commands exit 0
- GATE-COMPLETE — The checkbox is checked (`[x]`): 3/3 TC checkboxes `[x]`
- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists with: - The exact command or action used to verify - The a: a `[GATE-COMPLETE: TC-N]` entry with command/output exists for every TC (3)
- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : every Test Plan row (3) carries a test reference or a skip reason
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: every Test Plan row (3) carries a test reference or a skip reason
- GATE-COMPLETE — Spec document `## Completion Criteria` checkboxes are all `[x]`: 3/3 TC checkboxes `[x]`
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: every Test Plan row (3) carries a test reference or a skip reason
- GATE-COMPLETE — The spec's `## Tasks` section names the exact active task path under `.agents/tasks/`: `## Tasks` names `.agents/tasks/INFRA-136-loop-run-open-refuses-a-run-another-day-left-open-and-only-hand-editing-the-ledg.md`, which exists
- GATE-COMPLETE — That active task exists and is completion-ready: all tasks are `[x]`, with no pending or blocked item: 3/3 tasks `[x]` in .agents/tasks/INFRA-136-loop-run-open-refuses-a-run-another-day-left-open-and-only-hand-editing-the-ledg.md
