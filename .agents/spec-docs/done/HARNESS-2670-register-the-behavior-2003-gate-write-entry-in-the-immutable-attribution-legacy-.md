---
status: done
type: INFRA
tags: [harness]
lane: L1
---

# HARNESS-2670: Register the BEHAVIOR-2003 GATE-WRITE entry in the immutable attribution legacy list

Paired with `.agents/tasks/HARNESS-2670-register-the-behavior-2003-gate-write-entry-in-the-immutable-attribution-legacy-.md`. Arising from [issue #2670](https://github.com/woojubb/robota/issues/2670).

## Problem

`.agents/spec-docs/active/BEHAVIOR-2003-configure-contextual-tui-key-bindings.md` carries a
`### [GATE-WRITE] — ✅ PASS | 2026-09-15` entry with no `**Judged by:**` line and no same-entry
guardian declaration: it was judged after the 2026-09-06 attribution cutoff, in an active spec, by a
guardian that did not yet write the line. `scan-gate-verdict-attribution` reads only
`.agents/spec-docs/done`, so the entry is invisible today — and the post-merge completion closeout
of BEHAVIOR-2003 (its delivery merged as PR #2739) must move that spec to `done/` with an
append-only Evidence Log (`scan-user-execution-plan-order` refuses any rewrite of existing entries).

Reproduction: on a branch that archives the spec (`git mv active/… done/…`, status `done`),
`node scripts/harness/scan-gate-verdict-attribution.mjs` exits 1 with
`### [GATE-WRITE] — ✅ PASS | 2026-09-15 has missing or invalid attribution`, and adding the line is
refused by the closeout contract. Issue #2736 built `scripts/harness/immutable-attribution-legacy.json`
for exactly this class — immutable, pre-existing active-spec entries outside the done-only population —
but its enumeration did not include this entry.

## Prior Art Research

Waived: internal baseline maintenance; the remedy is the repository's own HARNESS-2736 mechanism

## Architecture Review

### Affected Scope

- `scripts/harness/immutable-attribution-legacy.json` — one appended entry (source, heading, sha256)
- `scripts/harness/__tests__/scan-gate-verdict-attribution.test.mjs` — one added case pinning the fingerprint
- No scan logic, gate evaluator, rule, workflow or product package changes.

### Alternatives Considered

1. Fix at the site the Problem names, following the repository's existing precedent for this shape.
   - Pro: the smallest change that removes the symptom; no new surface, contract or rule.
   - Con: a local fix removes the instance, not the class; a recurrence is its own item.
2. Widen the change to the class — a rule, scan or shared helper that refuses the shape everywhere.
   - Pro: removes the class rather than the instance.
   - Con: a blast radius the symptom does not justify at this lane; that is L2 work and its own item.

### Decision

**Alternative 1.** The issue #2736 mechanism already exists for this class; registering the one entry it missed keeps the evidence immutable and the scan honest, whereas deriving immutability from git history is L2 scan work with its own item.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: internal baseline maintenance; the remedy is the repository's own HARNESS-2736 mechanism
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

None

## Solution

Compute the entry's fingerprint with the scan's own `entryFingerprint` over the entry text as it
stands in the active spec (the text is identical after the archive move) and append
`{ source, heading, sha256 }` to `immutable-attribution-legacy.json`. Add a test that reads the real
spec (active or done) and the real legacy list and asserts `evaluateEntries` reports zero violations
for that entry — it fails with the JSON entry absent and cannot pass on an altered entry text.

## Affected Files

- `scripts/harness/immutable-attribution-legacy.json`
- `scripts/harness/__tests__/scan-gate-verdict-attribution.test.mjs`
- Paired HARNESS-2670 Task and spec records.

## Completion Criteria

- [x] TC-01: `pnpm exec vitest run scripts/harness/__tests__/scan-gate-verdict-attribution.test.mjs -t HARNESS-2670` → exits 0, and exits 1 with `immutable-attribution-legacy.json` reverted
- [x] TC-02: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` → exits 0
- [x] TC-03: `pnpm exec vitest run scripts/harness/__tests__/scan-gate-verdict-attribution.test.mjs` → exits 0 on the whole file, not only the new case

## Test Plan

| TC-ID | Test Type | Tool / Approach                                                                      | Notes                                             |
| ----- | --------- | ------------------------------------------------------------------------------------ | ------------------------------------------------- |
| TC-01 | Unit      | `scripts/harness/__tests__/scan-gate-verdict-attribution.test.mjs` `-t HARNESS-2670` | RED with the JSON entry reverted, GREEN with it   |
| TC-02 | Suite     | `run-all-scans.mjs --affected --context pr`                                          | Regression — the affected set, not the full suite |
| TC-03 | Unit      | `scripts/harness/__tests__/scan-gate-verdict-attribution.test.mjs`                   | The whole test file                               |

## User Execution Test Scenarios

Not applicable.

**Reason:** Nothing a person runs changes — no command, screen, output or setting; only the repository's
own evidence-attribution scan stops reporting one immutable historical entry as a new violation.

## Tasks

- [x] `.agents/tasks/completed/HARNESS-2670-register-the-behavior-2003-gate-write-entry-in-the-immutable-attribution-legacy-.md` — done 2026-09-19

## Evidence Log

### [GATE-APPROVAL] — ✅ PASS | 2026-09-19

**Status upgrade:** draft → approved
**Approval route:** `CLASS`
**Class:** `LANE-L0-L1`
**Instruction (verbatim):** "좋아 모두 승인한다. 빠르게 적용해줘. 필요하면 병렬 에이전트와 workflow를 적극 적용해줘"
**Given:** 2026-08-28, given 2026-08-28 in reply to the proposed row text 'L0·L1 레인 항목은 spec-workflow.md의 레인 정의대로 사전 승인한다' (registry row LANE-L0-L1, registered 2026-08-28)
**Evidence condition met:** `node scripts/harness/scan-lane-declaration.mjs --changed <2 path(s)> --diff-file <diff vs origin/develop> --trailers-file <Lane: L1>` over 2 changed path(s) — committed and working-tree changes vs origin/develop (merge base e3f31aa15c21) → exit 0, `lane-declaration summary: violations=0 result=PASS` (Lane L1 (spec-doc frontmatter .agents/spec-docs/draft/HARNESS-2670-register-the-behavior-2003-gate-write-entry-in-the-immutable-attribution-legacy-.md) is at or above the floor L0) — note: scan-lane-declaration exits 0 on this branch (lane-declaration summary: violations=0 result=PASS) and the spec declares lane: L1; every changed path (scripts/harness/immutable-attribution-legacy.json, scripts/harness/**tests**/scan-gate-verdict-attribution.test.mjs) sits at or below floor L1
**Review fingerprint:** 098386a002e8 (review 25eb66d0, type/tags cf40db57)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <2)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (098386a002e8) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `e3f31aa15c21` · base `origin/develop@e3f31aa15c21` · document `.agents/spec-docs/draft/HARNESS-2670-register-the-behavior-2003-gate-write-entry-in-the-immutable-attribution-legacy-.md` blob `dd9b4b39d2a1` (untracked)

### [GATE-PLAN] — ✅ PASS | 2026-09-19

**Status upgrade:** draft → approved

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: INFRA` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (1 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 1181 chars, 4 sentences
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
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (098386a002e8) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/HARNESS-2670-register-the-behavior-2003-gate-write-entry-in-the-immutable-attribution-legacy-.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/HARNESS-2670-register-the-behavior-2003-gate-write-entry-in-the-immutable-attribution-legacy-.md`, whose basename is the spec's
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `e3f31aa15c21` · base `origin/develop@e3f31aa15c21` · document `.agents/spec-docs/draft/HARNESS-2670-register-the-behavior-2003-gate-write-entry-in-the-immutable-attribution-legacy-.md` blob `8db725fa6287` (untracked)

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-09-19

**Command:** `pnpm exec vitest run scripts/harness/__tests__/scan-gate-verdict-attribution.test.mjs -t HARNESS-2670; echo '--- red-proof: with the JSON entry reverted'; git show HEAD~1:scripts/harness/immutable-attribution-legacy.json > scripts/harness/immutable-attribution-legacy.json; pnpm exec vitest run scripts/harness/__tests__/scan-gate-verdict-attribution.test.mjs -t HARNESS-2670; echo "reverted-run exit $?"; git checkout -- scripts/harness/immutable-attribution-legacy.json`
**Exit:** 0
**Output:** (last 10 of 61 line(s))

```

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed (1)
      Tests  1 failed | 13 skipped (14)
   Start at  07:22:02
   Duration  268ms (transform 76ms, setup 0ms, collect 116ms, tests 9ms, environment 0ms, prepare 27ms)

reverted-run exit 1
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `55377f5c47af` · base `origin/develop@e3f31aa15c21` · document `.agents/spec-docs/todo/HARNESS-2670-register-the-behavior-2003-gate-write-entry-in-the-immutable-attribution-legacy-.md` blob `5d9451a539db` (tracked)

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-09-19

**Command:** `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts`
**Exit:** 0
**Output:** (last 10 of 110 line(s))

```
✓ test-module-mocks
✓ backlog-placement
✓ llms-txt
✓ orphan-exports
✓ rule-statement-floor
✓ test-plans
✓ doc-folder-status
✓ package-boundary-ownership
62 scans passed, 1 skipped (63 declared what they examined)
scan receipt NOT written: working tree is not clean:  M .agents/spec-docs/todo/HARNESS-2670-register-the-behavior-2003-gate-write-entry-in-the-immutable-attribution-legacy-.md
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `55377f5c47af` · base `origin/develop@e3f31aa15c21` · document `.agents/spec-docs/todo/HARNESS-2670-register-the-behavior-2003-gate-write-entry-in-the-immutable-attribution-legacy-.md` blob `7b85322f5643` (modified)

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-09-19

**Command:** `pnpm exec vitest run scripts/harness/__tests__/scan-gate-verdict-attribution.test.mjs`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
7:22:16 AM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-5

 ✓ scripts/harness/__tests__/scan-gate-verdict-attribution.test.mjs (14 tests) 47ms

 Test Files  1 passed (1)
      Tests  14 passed (14)
   Start at  07:22:16
   Duration  305ms (transform 76ms, setup 0ms, collect 117ms, tests 47ms, environment 0ms, prepare 27ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `55377f5c47af` · base `origin/develop@e3f31aa15c21` · document `.agents/spec-docs/todo/HARNESS-2670-register-the-behavior-2003-gate-write-entry-in-the-immutable-attribution-legacy-.md` blob `0784c7b39462` (modified)

### [GATE-DONE] — ✅ PASS | 2026-09-19

**Status upgrade:** approved → done

- GATE-DONE — ordering: prior gate GATE-PLAN PASS and status `approved`: `[GATE-PLAN] — ✅ PASS | 2026-09-19` present with `**Status upgrade:** draft → approved`; document `status: approved` (recorded-pass rule satisfied)
- GATE-VERIFY — Every item in the `## Plan` section of `.agents/tasks/<ID>.md` is marked complete (`[x]`): Task `## Plan` holds 3 items (TC-01, TC-02, TC-03), 3/3 `[x]`; `node scripts/harness/scan-task-plan-items.mjs` → `task-plan-items scan passed.` (316 Task Plan sections examined)
- GATE-VERIFY — No Plan item is blocked or pending: no Plan item carries a blocked/pending marker or note; the words "blocked"/"pending" occur 0 times in the Task; no item is a self-disposition (merge/close/publish)
- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): branch diff vs `origin/develop` touches only `scripts/harness/immutable-attribution-legacy.json`, `scripts/harness/__tests__/scan-gate-verdict-attribution.test.mjs` and the HARNESS-2670 Task/spec; `pnpm build:affected` → `workspace-affected-run: build mode=none packages=0 … PASS tasks=0` (no workspace package affected)
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): `pnpm test:affected` → `workspace-affected-run: test mode=none packages=0 … PASS tasks=0`; the touched test surface re-run directly: `pnpm exec vitest run scripts/harness/__tests__/scan-gate-verdict-attribution.test.mjs` → 14 passed (14); red-proof reproduced by the guardian: with `HEAD~1:scripts/harness/immutable-attribution-legacy.json` in place the `-t HARNESS-2670` case fails (`expected [ { …(5) } ] to have a length of +0 but got 1`), with the committed JSON restored it passes (1 passed, 13 skipped); JSON restored byte-identically, `git status` unchanged
- GATE-COMPLETE — The checkbox is checked (`[x]`): 3/3 TC checkboxes `[x]` in `## Completion Criteria`
- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists with command, output and exit code: `[GATE-COMPLETE: TC-01]`, `[TC-02]`, `[TC-03]` entries present, each with `**Command:**`, `**Exit:** 0` and captured output; TC-01's output shows the reverted run exiting 1 (red) and the mechanical exit 0 (green)
- GATE-COMPLETE — One of test reference / test skipped is recorded per Test Plan row: TC-01 and TC-03 name `scripts/harness/__tests__/scan-gate-verdict-attribution.test.mjs` (TC-01 with `-t HARNESS-2670`), TC-02 names `run-all-scans.mjs --affected --context pr` as the suite; no row is empty
- GATE-COMPLETE — No TC-N is silently unaddressed: 3 Test Plan rows = 3 TC criteria, each with a tool reference
- GATE-COMPLETE — Spec document `## Completion Criteria` checkboxes are all `[x]`: 3/3 `[x]`
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: all 3 rows carry a Tool/Approach reference and Notes
- GATE-COMPLETE — The spec's `## Tasks` section names the exact active task path under `.agents/tasks/`: names `.agents/tasks/HARNESS-2670-register-the-behavior-2003-gate-write-entry-in-the-immutable-attribution-legacy-.md`, which exists
- GATE-COMPLETE — That active task exists and is completion-ready: Task `status: in-progress`, 3/3 Plan items `[x]`, no pending or blocked item

**Judged by:** `backlog-gate-guard` (semantic) + `gate.mjs` (mechanical)
**Judged at:** HEAD `55377f5c47af` · base `origin/develop@e3f31aa15c21` · document `.agents/spec-docs/todo/HARNESS-2670-register-the-behavior-2003-gate-write-entry-in-the-immutable-attribution-legacy-.md` blob `93e191d62062` (modified)
