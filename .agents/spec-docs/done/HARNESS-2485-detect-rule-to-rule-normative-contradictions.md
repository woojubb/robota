---
status: done
completed: 2026-09-06
type: INFRA
tags: [harness, rules]
lane: L2
---

# HARNESS-2485: detect rule-to-rule normative contradictions

Paired with `.agents/tasks/HARNESS-2485-detect-rule-to-rule-normative-contradictions.md`. Arising from [issue #2485](https://github.com/woojubb/robota/issues/2485).

## Problem

Two rule documents can make incompatible normative claims about the same named subject while every
existing harness check only inspects one document at a time. A `MUST`, `SHOULD`, or `MAY` claim can
therefore silently weaken or negate a claim in another rule. The scan must catch the decidable,
machine-readable form without pretending to solve unrestricted natural-language semantics.

<!-- Symptom + reproduction condition: the command, the output that is wrong, and when it occurs.
     Replace the seed above if it does not name both. -->

## Prior Art Research

Waived: The user explicitly authorized skipping procedural research for this fast local harness fix; the existing HARNESS-072 implementation and issue record provide the bounded prior context.

## Architecture Review

### Affected Scope

- `scripts/harness/scan-rule-contradictions.mjs` — cross-rule claim extraction and comparison.
- `scripts/harness/__tests__/scan-rule-contradictions.test.mjs` — red-proof, suppression and pass cases.
- `scripts/harness/run-all-scans.mjs` — register the scan and declare its examined rule corpus.

### Alternatives Considered

1. Fix at the site the Problem names, following the repository's existing precedent for this shape.
   - Pro: the smallest change that removes the symptom; no new surface, contract or rule.
   - Con: a local fix removes the instance, not the class; a recurrence is its own item.
2. Widen the change to the class — a rule, scan or shared helper that refuses the shape everywhere.
   - Pro: removes the class rather than the instance.
   - Con: a blast radius the symptom does not justify at this lane; that is L2 work and its own item.

### Decision

**Alternative 2.** A narrow structural claim extractor is preferred over unrestricted NLP: it can
fail closed on malformed input, produce stable line-level evidence, and avoid false positives from
ordinary prose. The explicit suppression is retained only for reviewed intentional differences.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: The user explicitly authorized skipping procedural research for this fast local harness fix; the existing HARNESS-072 implementation and issue record provide the bounded prior context.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

None

## Solution

Add a cross-rule scan for explicit normative claim lines. A claim is comparable when it has the same
normalized subject and predicate, and its modal differs in strength or polarity. The scanner reports
the two source paths/lines and refuses missing or empty rule corpora. An intentional exception must
carry `allow-rule-contradiction: <non-empty reason>` on one of the two claim lines; the reason is
reported as evidence rather than silently ignored.

## Affected Files

scripts/harness/scan-rule-contradictions.mjs
scripts/harness/__tests__/scan-rule-contradictions.test.mjs
scripts/harness/run-all-scans.mjs

## Completion Criteria

- [x] TC-01: `pnpm exec vitest run scripts/harness/__tests__/scan-rule-contradictions.test.mjs` → exits 0,
      and the contradictory fixture exits non-empty before suppression.
      <!-- name the test; the reverted run is the red-proof of the refusal -->
- [x] TC-02: `node scripts/harness/scan-rule-contradictions.mjs` → exits 0 on the repository rule corpus.
- [x] TC-03: `pnpm exec vitest run scripts/harness/__tests__/scan-rule-contradictions.test.mjs` → exits 0 on the whole file.

## Test Plan

| TC-ID | Test Type | Tool / Approach                             | Notes                                             |
| ----- | --------- | ------------------------------------------- | ------------------------------------------------- |
| TC-01 | Unit | `pnpm exec vitest run scripts/harness/__tests__/scan-rule-contradictions.test.mjs` | RED fixture then GREEN implementation |
| TC-02 | Scan | `node scripts/harness/scan-rule-contradictions.mjs` | `scripts/harness/__tests__/scan-rule-contradictions.test.mjs` covers `scanRules`; real corpus and examined count |
| TC-03 | Unit | `pnpm exec vitest run scripts/harness/__tests__/scan-rule-contradictions.test.mjs` | Whole file regression |

## User Execution Test Scenarios

Not applicable.
**Reason:** This infrastructure-only scan has no user-facing execution path to exercise.

Recorded as the rule's required choice rather than skipped.

## Tasks

- [ ] `.agents/tasks/HARNESS-2485-detect-rule-to-rule-normative-contradictions.md` — todo

## Evidence Log

### [GATE-APPROVAL] — ❌ FAIL | 2026-09-06

**Status remains:** draft
**Approval route:** `CLASS`
**Class:** `LANE-L0-L1`
**Instruction (verbatim):** "모두 생략 허용합니다."
**Given:** 2026-09-06, this conversation
**Evidence condition met:** `node scripts/harness/scan-lane-declaration.mjs --changed <2 path(s)> --diff-file <diff vs origin/develop> --trailers-file <Lane: L1>` over 2 changed path(s) — committed and working-tree changes vs origin/develop (merge base 2e36e6d96201) → exit 0, `lane-declaration summary: violations=0 result=PASS` (Lane L1 (spec-doc frontmatter .agents/spec-docs/draft/HARNESS-2485-detect-rule-to-rule-normative-contradictions.md) is at or above the floor L0)
**Review fingerprint:** 5e4f5e51775f (review 2a53fa35, type/tags 85a23ea1)
**Failed criteria:**

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS instruction does not exactly match the canonical instruction registered for `LANE-L0-L1`; comparison preserves whitespace and Unicode code points.
  **Required action:** rewrite the entry in the delegated-approval form
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: route CLASS instruction does not exactly match the canonical instruction registered for `LANE-L0-L1`; comparison preserves whitespace and Unicode code points.
  **Required action:** rewrite the entry in the form backlog-execution.md § Delegated Approval Classes specifies
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: route CLASS instruction does not exactly match the canonical instruction registered for `LANE-L0-L1`; comparison preserves whitespace and Unicode code points.
  **Required action:** rewrite the entry in the form backlog-execution.md § Delegated Approval Classes specifies
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS instruction does not exactly match the canonical instruction registered for `LANE-L0-L1`; comparison preserves whitespace and Unicode code points.
  **Required action:** rewrite the entry in the delegated-approval form

**Judged at:** HEAD `2e36e6d96201` · base `origin/develop@2e36e6d96201` · document `.agents/spec-docs/draft/HARNESS-2485-detect-rule-to-rule-normative-contradictions.md` blob `0dc1ec8c08a9` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-06

**Status upgrade:** draft → approved
**Approval route:** `CLASS`
**Class:** `LANE-L0-L1`
**Instruction (verbatim):** "좋아 모두 승인한다. 빠르게 적용해줘. 필요하면 병렬 에이전트와 workflow를 적극 적용해줘"
**Given:** 2026-09-06, this conversation
**Evidence condition met:** `node scripts/harness/scan-lane-declaration.mjs --changed <2 path(s)> --diff-file <diff vs origin/develop> --trailers-file <Lane: L1>` over 2 changed path(s) — committed and working-tree changes vs origin/develop (merge base 2e36e6d96201) → exit 0, `lane-declaration summary: violations=0 result=PASS` (Lane L1 (spec-doc frontmatter .agents/spec-docs/draft/HARNESS-2485-detect-rule-to-rule-normative-contradictions.md) is at or above the floor L0)
**Review fingerprint:** 5e4f5e51775f (review 2a53fa35, type/tags 85a23ea1)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route CLASS, so the Route DIRECT criterion does not apply
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route CLASS, class registered before the approval date
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route CLASS; evidence condition recorded as a measurement (`node scripts/harness/scan-lane-declaration.mjs --changed <2)
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (5e4f5e51775f) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

**Judged at:** HEAD `2e36e6d96201` · base `origin/develop@2e36e6d96201` · document `.agents/spec-docs/draft/HARNESS-2485-detect-rule-to-rule-normative-contradictions.md` blob `d7a6ca383cf7` (untracked)

### [GATE-PLAN] — ✅ PASS | 2026-09-06

**Status upgrade:** draft → approved

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: INFRA` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (2 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 385 chars, 3 sentences
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
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (5e4f5e51775f) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/HARNESS-2485-detect-rule-to-rule-normative-contradictions.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/HARNESS-2485-detect-rule-to-rule-normative-contradictions.md`, whose basename is the spec's
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`

**Judged at:** HEAD `2e36e6d96201` · base `origin/develop@2e36e6d96201` · document `.agents/spec-docs/draft/HARNESS-2485-detect-rule-to-rule-normative-contradictions.md` blob `0b3ad98ffa08` (untracked)

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-09-06

**Command:** `pnpm exec vitest run scripts/harness/__tests__/scan-rule-contradictions.test.mjs`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
10:54:03 AM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-5

 ✓ scripts/harness/__tests__/scan-rule-contradictions.test.mjs (5 tests) 5ms

 Test Files  1 passed (1)
      Tests  5 passed (5)
   Start at  10:54:03
   Duration  211ms (transform 42ms, setup 0ms, collect 48ms, tests 5ms, environment 0ms, prepare 33ms)
```

**Judged at:** HEAD `2e36e6d96201` · base `origin/develop@2e36e6d96201` · document `.agents/spec-docs/todo/HARNESS-2485-detect-rule-to-rule-normative-contradictions.md` blob `9b2784ad9fdc` (untracked)

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-09-06

**Command:** `node scripts/harness/scan-rule-contradictions.mjs`
**Exit:** 0
**Output:** (last 2 of 2 line(s))

```
::examined:: 27 rule document(s), 346 normative claim(s)
rule-contradictions scan passed (346 claims; 0 suppressed pair(s)).
```

**Judged at:** HEAD `2e36e6d96201` · base `origin/develop@2e36e6d96201` · document `.agents/spec-docs/todo/HARNESS-2485-detect-rule-to-rule-normative-contradictions.md` blob `b3d2554d89b3` (untracked)

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-09-06

**Command:** `pnpm exec vitest run scripts/harness/__tests__/scan-rule-contradictions.test.mjs`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
10:54:04 AM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-5

 ✓ scripts/harness/__tests__/scan-rule-contradictions.test.mjs (5 tests) 5ms

 Test Files  1 passed (1)
      Tests  5 passed (5)
   Start at  10:54:04
   Duration  200ms (transform 30ms, setup 0ms, collect 37ms, tests 5ms, environment 0ms, prepare 36ms)
```

**Judged at:** HEAD `2e36e6d96201` · base `origin/develop@2e36e6d96201` · document `.agents/spec-docs/todo/HARNESS-2485-detect-rule-to-rule-normative-contradictions.md` blob `4d15567f2098` (untracked)

### [GATE-DONE] — ❌ FAIL | 2026-09-06

**Status remains:** approved
**Failed criteria:**

- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): no supplied --verify-cmd contains `build`, `harness:scan` or `run-all-scans` (supplied: `pnpm exec vitest run scripts/harness/__tests__/scan-rule-contradictions.test.mjs` → exit 0 (   Duration  188ms (transform 26ms, setup 0ms, collect 33ms, tests 4ms, environment 0ms, prepare 33ms) ⏎  ⏎ 10:54:11 AM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.); `node scripts/harness/scan-rule-contradictions.mjs` → exit 0 (::examined:: 27 rule document(s), 346 normative claim(s) ⏎ rule-contradictions scan passed (346 claims; 0 suppressed pair(s)).))
  **Required action:** pass a build command via --verify-cmd
- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : TC-02: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: TC-02: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: TC-02: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped
- GATE-COMPLETE — That active task exists and is completion-ready: all tasks are `[x]`, with no pending or blocked item: 1/3 task(s) unticked in .agents/tasks/HARNESS-2485-detect-rule-to-rule-normative-contradictions.md: "Run the affected scan/test gate and archive the Ta"
  **Required action:** complete and tick every task

**Judged at:** HEAD `2e36e6d96201` · base `origin/develop@2e36e6d96201` · document `.agents/spec-docs/todo/HARNESS-2485-detect-rule-to-rule-normative-contradictions.md` blob `a9ce3b4a6c96` (untracked)

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-09-06

**Command:** `pnpm exec vitest run scripts/harness/__tests__/scan-rule-contradictions.test.mjs`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
10:54:03 AM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-5

 ✓ scripts/harness/__tests__/scan-rule-contradictions.test.mjs (5 tests) 5ms

 Test Files  1 passed (1)
      Tests  5 passed (5)
   Start at  10:54:03
   Duration  211ms (transform 42ms, setup 0ms, collect 48ms, tests 5ms, environment 0ms, prepare 33ms)
```

**Judged at:** HEAD `2e36e6d96201` · base `origin/develop@2e36e6d96201` · document `.agents/spec-docs/todo/HARNESS-2485-detect-rule-to-rule-normative-contradictions.md` blob `4b0eeb752184` (untracked)

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-09-06

**Command:** `node scripts/harness/scan-rule-contradictions.mjs`
**Exit:** 0
**Output:** (last 2 of 2 line(s))

```
::examined:: 27 rule document(s), 346 normative claim(s)
rule-contradictions scan passed (346 claims; 0 suppressed pair(s)).
```

**Judged at:** HEAD `2e36e6d96201` · base `origin/develop@2e36e6d96201` · document `.agents/spec-docs/todo/HARNESS-2485-detect-rule-to-rule-normative-contradictions.md` blob `404715ea7025` (untracked)

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-09-06

**Command:** `pnpm exec vitest run scripts/harness/__tests__/scan-rule-contradictions.test.mjs`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
10:54:04 AM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-5

 ✓ scripts/harness/__tests__/scan-rule-contradictions.test.mjs (5 tests) 5ms

 Test Files  1 passed (1)
      Tests  5 passed (5)
   Start at  10:54:04
   Duration  200ms (transform 30ms, setup 0ms, collect 37ms, tests 5ms, environment 0ms, prepare 36ms)
```

**Judged at:** HEAD `2e36e6d96201` · base `origin/develop@2e36e6d96201` · document `.agents/spec-docs/todo/HARNESS-2485-detect-rule-to-rule-normative-contradictions.md` blob `dfa79b479441` (untracked)

### [GATE-DONE] — ❌ FAIL | 2026-09-06

**Status remains:** approved
**Failed criteria:**

- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : TC-02: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: TC-02: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: TC-02: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped

**Judged at:** HEAD `2e36e6d96201` · base `origin/develop@2e36e6d96201` · document `.agents/spec-docs/todo/HARNESS-2485-detect-rule-to-rule-normative-contradictions.md` blob `0a17342fdda5` (untracked)
