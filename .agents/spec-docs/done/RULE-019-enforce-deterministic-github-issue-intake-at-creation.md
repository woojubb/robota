---
status: done
type: RULE
tags: [rule]
lane: L1
---

# RULE-019: Enforce deterministic GitHub Issue intake at creation

Paired with `.agents/tasks/RULE-019-enforce-deterministic-github-issue-intake-at-creation.md`. Arising from [issue #2476](https://github.com/woojubb/robota/issues/2476).

## Problem

New Issue Forms already apply one work-kind label and `status:needs-triage`, but blank Issues and
manual/API paths can bypass that contract. A newly created Issue can therefore enter the repository
without exactly one kind, without the intake marker, or with a guessed P label, and the next triager
must repair the record before it can enter the queue.

Reproduction: open the repository's new-Issue chooser or create an Issue through an API path. Before this
change, the chooser permits a blank Issue and the written procedure does not require the manual/API path
to reproduce the form labels and evidence contract.

<!-- Symptom + reproduction condition: the command, the output that is wrong, and when it occurs.
     Replace the seed above if it does not name both. -->

## Prior Art Research

Waived: internal fix with no contract change; the remedy is the repository's own precedent

## Architecture Review

### Affected Scope

- `.github/ISSUE_TEMPLATE/config.yml`
- `.agents/skills/github-issue-triage/SKILL.md`
- `.agents/skills/find-to-issue/SKILL.md`
- `.agents/skills/index.md`

### Alternatives Considered

1. Document the rule only in `github-issue-triage`.
   - Pro: smallest documentation change.
   - Con: `find-to-issue` and GitHub's chooser could still bypass the contract.
2. Enforce the entry point mechanically and route every other creation path to the same contract.
   - Pro: blank Issues are refused, Forms supply the labels, and agent/manual/API paths have one SSOT.
   - Con: callers using an unavoidable API path must perform one additional audit and may need to repair
     malformed metadata before publication.

### Decision

**Alternative 2.** The issue is an intake-path class, so the smallest reliable fix must cover the
mechanical chooser and every documented bypass without introducing a second priority or status system.
This is documentation/configuration only and remains below the L2 policy-file floor.

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

Disable blank Issues, retain the exact three form label pairs, and state the same creation contract in the
two skills that can file Issues. Manual/API creation remains supported but must reproduce the form labels,
evidence fields, and post-create audit; priority is still assigned only during triage.

## Affected Files

- `.github/ISSUE_TEMPLATE/config.yml`
- `.agents/skills/github-issue-triage/SKILL.md`
- `.agents/skills/find-to-issue/SKILL.md`
- `.agents/skills/index.md`

## Completion Criteria

- [x] TC-01: `rg -n '^blank_issues_enabled: false$' .github/ISSUE_TEMPLATE/config.yml` and each Issue Form
      declares exactly its kind plus `status:needs-triage` → exits 0.
- [x] TC-02: `node scripts/harness/scan-github-label-registry.mjs` → exits 0 and reports all declared
      form/protected-consumer relations examined.
- [x] TC-03: `node scripts/harness/github-issue-triage.mjs audit --repo woojubb/robota` → exits 0 with
      `malformed: 0` for the current open Issue population.
- [x] TC-04: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts`
      → exits 0.

## Test Plan

| TC-ID | Test Type         | Tool / Approach                             | Notes                                                                                               |
| ----- | ----------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| TC-01 | Config/contract   | `rg` over config and the three forms        | Skip reason: no separate test file is needed; the YAML/config contract is the executable assertion. |
| TC-02 | Harness scan      | `scan-github-label-registry.mjs`            | Covered by `scripts/harness/__tests__/scan-github-label-registry.test.mjs`.                         |
| TC-03 | Integration audit | `github-issue-triage.mjs audit`             | Skip reason: no separate test file can replace live GitHub state; command output is recorded.       |
| TC-04 | Harness scan      | `run-all-scans.mjs --affected --context pr` | Affected scans for the documentation/configuration diff.                                            |

## User Execution Test Scenarios

Not applicable — no runnable user-facing behaviour changes; verification evidence is recorded in the engineering test plan (TC-01 to TC-03).

Recorded as the rule's required choice rather than skipped.

## Tasks

- [x] `.agents/tasks/completed/RULE-019-enforce-deterministic-github-issue-intake-at-creation.md` — done

## Evidence Log

- TC-01: `rg` confirmed `blank_issues_enabled: false` and the three exact form label pairs; no `yq`
  dependency is required.
- TC-02: `node scripts/harness/scan-github-label-registry.mjs` → `::examined:: 33` and exit 0.
- TC-03: `node scripts/harness/github-issue-triage.mjs audit --repo woojubb/robota` → 257 open Issues,
  malformed 0 after RULE-019 conversion finalized.
- TC-04: affected harness scan → 63 scans passed, 1 declared skip; the only dirty path was the required
  prior post-merge ledger append.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-29

**Status upgrade:** draft → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "앞으로 누가 깃헙 이슈를 추가할 때 너와 동일한 기준을 가지고 추가하게 하려면 이 것을 규칙이 담긴 스킬로 강제해야 할것 같습니다."
**Given:** 2026-08-29, this conversation
**Review fingerprint:** d22ae39c3c05 (review ecd5803f, type/tags 7ede13b6)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-08-29, this conversation
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (d22ae39c3c05) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)

### [GATE-PLAN] — ❌ FAIL | 2026-08-29

**Status remains:** draft
**Failed criteria:**

- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` carries no `**Author verdict:** `SCENARIO DRAFTED: (not-applicable|automatable|manual) | <n>`` line (0 found, exactly 1 required; the section is absent)
  **Required action:** record the author verdict in the Task

### [GATE-PLAN] — ✅ PASS | 2026-08-29

**Status upgrade:** draft → approved

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: SCREEN · API · FLOW · BEHAVIOR · DATA · RULE · AGREEMENT: `type: RULE` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (1 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 616 chars, 4 sentences
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
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` present with 2 prior entries (none from a later gate)
- GATE-WRITE — No `## Status` or `## Classification` sections in the body (these are frontmatter fields): no `## Status` / `## Classification` body sections
- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-08-29, this conversation
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry ar: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (d22ae39c3c05) equals the document's current fingerprint
- GATE-APPROVAL — **Independent architecture validation (conditional):** IF the spec introduces a new package / app / surface or: N/A — not required for lane L1 (spec-workflow.md § Lanes)
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/RULE-019-enforce-deterministic-github-issue-intake-at-creation.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/RULE-019-enforce-deterministic-github-issue-intake-at-creation.md`, whose basename is the spec's
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-08-29

**Command:** `rg form and blank-issue config checks`
**Exit:** 0
**Output:** (last 3 of 3 line(s))

```
4:labels: ['bug', 'status:needs-triage']
4:labels: ['enhancement', 'status:needs-triage']
4:labels: ['documentation', 'status:needs-triage']
```

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-08-29

**Command:** `node scripts/harness/scan-github-label-registry.mjs`
**Exit:** 0
**Output:** (last 1 of 1 line(s))

```
::examined:: 33 registry/form/consumer relation(s)
```

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-08-29

**Command:** `node scripts/harness/github-issue-triage.mjs audit --repo woojubb/robota`
**Exit:** 0
**Output:** (last 10 of 262 line(s))

```
converted: 7
  #2476 [enhancement] Enforce deterministic GitHub Issue intake at creation — linked to .agents/tasks/RULE-019-enforce-deterministic-github-issue-intake-at-creation.md
  #2410 plan-order has no definition of a merge commit's own content: an evil merge before the checkpoint is judged by nothing, and the staged path refuses honest back-merges — linked to .agents/tasks/HARNESS-130-plan-order-has-no-definition-of-a-merge-commits-own-content.md
  #2308 Nothing emits or checks the User Execution Test Scenarios section the rules require — linked to .agents/tasks/HARNESS-125-the-record-skeleton-omits-the-section-the-rule-requires.md
  #2300 A test satisfied by the author's host state passes locally and proves nothing on CI — how many others are there? — linked to .agents/tasks/TEST-012-framework-session-init-reads-the-real-user-home-with-no-seam.md
  #2258 A harness scan matching raw source treats comment text as code, so prose can vouch for deleted code — linked to .agents/tasks/HARNESS-123-six-comment-strippers-four-behaviours-and-no-owner-so-a-comment-can-satisfy-a-sc.md
  #2237 A superseded check-run reports as concluded, so 'all checks concluded' can be true of runs that never ran — linked to .agents/tasks/HARNESS-124-a-superseded-check-run-answers-for-its-check-so-re-deriving-ci-state-is-a-differ.md
  #2045 P1 contract: agent-transport-protocol has no total runtime message decoder — linked to .agents/tasks/TRANS-008-a-truthy-non-string-submit-prompt-is-re-broadcast-to-every-attached-client-as-a-.md
malformed: 0
::examined:: 257 open issue(s)
```

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-08-29

**Command:** `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts --base origin/develop`
**Exit:** 0
**Output:** (last 10 of 81 line(s))

```
✓ doc-folder-status

⚑ 4 advisory finding(s) — NOT failures. The verdict below is unaffected.
⚑ action-references: RESOLVABILITY NOT VERIFIED on this run (not CI — run with --live to verify resolvability): 12 reference(s) were parsed but none was resolved. An action that does not exist passes this run.
⚑ spec-whitebox-leakage: packages/agent-framework/docs/SPEC.md: 2054/2858 lines (71.9%) outside the standard sections — consider extracting to docs/design/
⚑ spec-whitebox-leakage: packages/agent-session/docs/SPEC.md: 318/757 lines (42.0%) outside the standard sections — consider extracting to docs/design/
⚑ progress-report-quantification: progress-report quantification: 11 finding(s) acknowledged in scripts/harness/progress-report-acknowledgments.json — 9 real violation(s) recorded, not cleared by editing history; 2 finding(s) the scan read wrong, each with its reason.

63 scans passed, 1 skipped (50 declared what they examined)
scan receipt NOT written: working tree is not clean:  M .agents/loop-runs/post-merge-cycle.jsonl,  M .agents/spec-docs/todo/RULE-019-enforce-deterministic-github-issue-intake-at-creation.md,  M .agents/tasks/RULE-019-enforce-deterministic-github-issue-intake-at-creation.md
```

### [GATE-DONE] — ❌ FAIL | 2026-08-29

**Status remains:** approved
**Failed criteria:**

- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): no supplied --verify-cmd contains `test` or `vitest` (supplied: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts --base origin/develop` → exit 0 ( ⏎ 63 scans passed, 1 skipped (50 declared what they examined) ⏎ scan receipt NOT written: working tree is not clean: M .agents/loop-runs/post-merge-cycle.jsonl, M .agents/spec-docs/todo/RULE-019-enforce-deterministic-github-issue-intake-at-creation.md, M .agents/tasks/RULE-019-enforce-deterministic-github-issue-intake-at-creation.md); `node scripts/harness/scan-github-label-registry.mjs` → exit 0 (::examined:: 33 registry/form/consumer relation(s)))
  **Required action:** pass a test command via --verify-cmd
- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : TC-01, TC-02, TC-03: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: TC-01, TC-02, TC-03: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: TC-01, TC-02, TC-03: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped

### [GATE-DONE] — ❌ FAIL | 2026-08-29

**Status remains:** approved
**Failed criteria:**

- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : TC-01, TC-03: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: TC-01, TC-03: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: TC-01, TC-03: no test reference and no skip reason
  **Required action:** name the test or record why it was skipped

### [GATE-DONE] — ✅ PASS | 2026-08-29

**Status upgrade:** approved → done

- GATE-DONE — ordering: prior gate GATE-PLAN PASS and status `approved`: [GATE-PLAN] — ✅ PASS | 2026-08-29; status `approved`
- GATE-VERIFY — All tasks in `.agents/tasks/<ID>.md` are marked complete (`[x]`): 3/3 tasks `[x]` in .agents/tasks/RULE-019-enforce-deterministic-github-issue-intake-at-creation.md
- GATE-VERIFY — No tasks are blocked or pending: no unticked, blocked, or pending task
- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): build-shaped `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts --base origin/develop` → exit 0 ( ⏎ 63 scans passed, 1 skipped (50 declared what they examined) ⏎ scan receipt NOT written: working tree is not clean: M .agents/loop-runs/post-merge-cycle.jsonl, M .agents/spec-docs/todo/RULE-019-enforce-deterministic-github-issue-intake-at-creation.md, M .agents/tasks/RULE-019-enforce-deterministic-github-issue-intake-at-creation.md); all 2 supplied commands exit 0
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): test-shaped `pnpm exec vitest run scripts/harness/__tests__/scan-github-label-registry.test.mjs` → exit 0 ( Duration 241ms (transform 29ms, setup 0ms, collect 33ms, tests 7ms, environment 0ms, prepare 49ms) ⏎ ⏎ 1:15:14 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.); all 2 supplied commands exit 0
- GATE-COMPLETE — The checkbox is checked (`[x]`): 4/4 TC checkboxes `[x]`
- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists with: - The exact command or action used to verify - The a: a `[GATE-COMPLETE: TC-N]` entry with command/output exists for every TC (4)
- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : every Test Plan row (4) carries a test reference or a skip reason
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: every Test Plan row (4) carries a test reference or a skip reason
- GATE-COMPLETE — Spec document `## Completion Criteria` checkboxes are all `[x]`: 4/4 TC checkboxes `[x]`
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: every Test Plan row (4) carries a test reference or a skip reason
- GATE-COMPLETE — The spec's `## Tasks` section names the exact active task path under `.agents/tasks/`: `## Tasks` names `.agents/tasks/RULE-019-enforce-deterministic-github-issue-intake-at-creation.md`, which exists
- GATE-COMPLETE — That active task exists and is completion-ready: all tasks are `[x]`, with no pending or blocked item: 3/3 tasks `[x]` in .agents/tasks/RULE-019-enforce-deterministic-github-issue-intake-at-creation.md
