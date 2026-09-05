---
status: in-progress
type: RULE
lane: L2
tags: [cli, typescript]
---

# RULE-025: Enforce issue closure terminal rules

## Problem

The repository permits a started Task to remain open after its cited delivery is merged, has no declared recovery route when a gate tool defect blocks a document, permits gate-evaluator code to be changed inside the work it evaluates, does not select owning tests before broad verification, and lacks a pre-start rejection checklist. These failures are reproducible in the five F1–F5 cases recorded in `/tmp/robota-issues/round2/ISSUE-CLOSURE-RULES.md`; the current rules and scans do not produce a blocking or advisory finding for all of those states.

## Prior Art Research

GitHub documents two terminal reasons for closing an issue that match this work's distinction: a fix is complete, or work is not planned. It also documents that a linked pull request can close the issue when merged. These product-level semantics support keeping “completed delivery” and “declined before start” as explicit terminal outcomes while retaining an auditable exception for tool defects. Sources: [Closing an issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/administering-issues/closing-an-issue) and [Linking a pull request to an issue](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/linking-a-pull-request-to-an-issue).

## Architecture Review

### Affected Scope

- `.agents/rules/backlog-execution.md`
- `.agents/rules/enforcement-architecture.md`
- `.agents/rules/verification.md`
- `.agents/specs/gate-catalogue.md`
- `.agents/skills/backlog-execution-orchestrator/SKILL.md`
- `scripts/harness/scan-task-merged-citation.mjs`
- `scripts/harness/gate.mjs`
- `scripts/harness/harness-test-classification.mjs`
- `scripts/harness/run-all-scans.mjs`
- `scripts/harness/__tests__/scan-task-merged-citation.test.mjs`
- new focused harness tests for the new scan and gate protections

### Alternatives Considered

1. Documentation-only rules. Pro: smallest diff and immediate guidance. Con: it leaves the exact failure modes silent, so the observed closure failures can recur.
2. Independent scripts for each F1–F4 item. Pro: narrow ownership and isolated tests. Con: duplicates history/task parsing and makes registration and maintenance more expensive.
3. Extend existing gate/task/test registries and add focused checks. Pro: reuses the repository's established SSOT and fail-loud scan runner, while keeping each invariant independently testable. Con: the shared harness has a wider review surface.

### Decision

Choose alternative 3. The closure rules are policy changes, so the authoritative documents state the lifecycle and exception semantics; existing registries are extended where they already own the relevant state. The trade-off is a wider harness diff in exchange for one reachable enforcement path, explicit test coverage, and no parallel source of task or gate semantics. The recommendation is validated against the current task lifecycle parser, gate evidence format, scan registry, and hermetic test classification; an adversarial pass will cover stale merged tasks, missing issue metadata, evaluator-path overlap, and tests that accidentally read the live tree.

**Delivery mode:** `single`

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: this is repository governance and harness infrastructure, not a new product surface
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None

## Solution

Add the authoritative terminal-state, tool-defect re-judgement, evaluator-isolation, owning-test, and pre-start rejection rules. Extend the existing merged-task citation machinery with a bounded terminal-state finding, make gate evidence able to record a machine-readable `Closed under: tool-defect` disposition, add a mechanical guard for evaluator changes mixed with the evaluated gate evidence, expose an owning-test command/selection path, and register hermetic-safe tests for the new behavior.

## Affected Files

See Affected Scope. The implementation may add only focused `scripts/harness/**` modules and their `__tests__` counterparts required by the solution; no product package source is in scope.

## Completion Criteria

- [ ] TC-01: `backlog-execution.md` and `backlog-execution-orchestrator/SKILL.md` state that started work ends only as delivered-and-closed or rejected-before-start, including the four rejection checks.
- [ ] TC-02: The gate catalogue and gate evidence format define and mechanically parse the documented `tool-defect` closure disposition with a defect identifier and evidence locations.
- [ ] TC-03: Harness verification reports a finding when a merged delivery leaves a non-terminal in-progress Task beyond the configured age, and refuses evaluator-code/evaluated-gate evidence overlap.
- [ ] TC-04: Harness test classification and the owning-test entry point identify tests covering changed harness files, and hermetic tests remain runnable without live-tree owners.
- [ ] TC-05: Focused regression tests fail for the relevant invalid fixtures and pass for valid terminal, tool-defect, evaluator-isolated, and hermetic classifications; the registered harness scan and affected verification are green.

## Test Plan

| TC-ID | Test Type        | Tool / Approach                                                                                              | Notes                                                                      |
| ----- | ---------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| TC-01 | rule/document    | `pnpm harness:scan` plus rule-shape tests                                                                    | Verify required lifecycle and rejection language is present in its owners. |
| TC-02 | unit/integration | Vitest tests for gate evidence parsing and `gate.mjs` fixtures                                               | Exercise valid and malformed `Closed under` entries.                       |
| TC-03 | unit/integration | Vitest tests for terminal-state and evaluator-overlap checks                                                 | Use synthetic git/task/evidence fixtures; assert exact finding types.      |
| TC-04 | unit/integration | `harness-test-classification` tests and owning-test command                                                  | Verify complete partition and no live-tree reads in hermetic fixtures.     |
| TC-05 | verification     | `pnpm harness:test:owning`, `pnpm harness:test:hermetic`, `pnpm harness:scan`, `pnpm harness:verify-like-ci` | Record command outputs and exit codes in the Evidence Log.                 |

## Tasks

- [ ] `.agents/tasks/RULE-025-enforce-issue-closure-terminal-rules.md` — paired implementation Task

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-09-06

**Status upgrade:** draft → review-ready
The Problem names the concrete silent closure states and the reproducible F1–F5 conditions. Prior-art research cites GitHub's documented completed/not-planned closure semantics and uses them to select explicit terminal outcomes. The Architecture Review identifies the affected governance and harness layers, compares three alternatives, and chooses the registered-scan extension with the trade-off recorded. All five TC criteria use observable command or output forms and have matching Test Plan rows.
**Judged at:** HEAD `working-tree` · base `origin/develop@d9b521a06` · document `.agents/spec-docs/draft/RULE-025-enforce-issue-closure-terminal-rules.md` blob `working-tree` (modified)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-06

**Status upgrade:** draft → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "/goal /tmp/robota-issues/round2/ISSUE-CLOSURE-RULES.md 이거 해결완료할 때까지 반복해"
**Given:** 2026-09-06, this conversation
**Review fingerprint:** bdd0efafaac8 (review 6eb95eaf, type/tags 89cbb121)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-06, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (bdd0efafaac8) equals the document's current fingerprint

**Judged at:** HEAD `d9b521a06c71` · base `origin/develop@d9b521a06c71` · document `.agents/spec-docs/draft/RULE-025-enforce-issue-closure-terminal-rules.md` blob `57136c461683` (untracked)

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-09-06

**Status remains:** approved
**Failed criteria:**

- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names 0/5 TC ids and carries 4 checkbox task(s)
  **Required action:** one task per TC-N

**Judged at:** HEAD `d9b521a06c71` · base `origin/develop@d9b521a06c71` · document `.agents/spec-docs/todo/RULE-025-enforce-issue-closure-terminal-rules.md` blob `ede97d648551` (untracked)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-06

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-06; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/RULE-025-enforce-issue-closure-terminal-rules.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/RULE-025-enforce-issue-closure-terminal-rules.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (5)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 336 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->

```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/RULE-025-enforce-issue-closure-terminal-rules.md",
  "specPath": ".agents/spec-docs/todo/RULE-025-enforce-issue-closure-terminal-rules.md",
  "taskItems": [
    {
      "kind": "tc-id",
      "value": "TC-01"
    },
    {
      "kind": "tc-id",
      "value": "TC-02"
    },
    {
      "kind": "tc-id",
      "value": "TC-03"
    },
    {
      "kind": "tc-id",
      "value": "TC-04"
    },
    {
      "kind": "tc-id",
      "value": "TC-05"
    }
  ],
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/spec-docs/todo/RULE-025-enforce-issue-closure-terminal-rules.md",
    ".agents/tasks/RULE-025-enforce-issue-closure-terminal-rules.md"
  ]
}
```

<!-- checkpoint-evidence:v2:end -->

**Judged at:** HEAD `d9b521a06c71` · base `origin/develop@d9b521a06c71` · document `.agents/spec-docs/todo/RULE-025-enforce-issue-closure-terminal-rules.md` blob `07cb55de5502` (untracked)
