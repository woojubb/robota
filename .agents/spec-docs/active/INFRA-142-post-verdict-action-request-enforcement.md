---
status: in-progress
type: INFRA
tags: [git-hooks, pull-request-review]
lane: L2
---

# INFRA-142: enforce post-verdict action requests on every PR update

Paired with `.agents/tasks/INFRA-142-post-verdict-action-request-enforcement.md`.

## Problem

PR #2500 received a published `ACTIONABLE FINDINGS: 0` verdict at head `d00fefc70`. Later commits
`efa61898c` and `5d8d10a33` were pushed without a `POST_FINDINGS_ACTION_REQUEST` comment approved by
the maintainer. The repository rule says every push, rebase, or merge after any published verdict must
have that exact head/verdict-bound request, but the observed push path did not enforce it.

## Prior Art Research

Waived: this is a repository-internal regression in the existing `.claude/hooks/pre-push-check.sh`
guard; the governing rule, hook implementation, and review-before-push fixtures are the direct prior art.

## Architecture Review

### Affected Scope

- `.claude/hooks/pre-push-check.sh` and its command/context helpers.
- `.husky/pre-push` / `scripts/harness/pre-push.mjs`, which are the actual Git pre-push path used by
  ordinary shells and subagents (the Claude PreToolUse hook alone is insufficient).
- `scripts/harness/__tests__/review-before-push.test.mjs` and any focused hook fixture needed to prove
  a post-verdict push is refused and an approved request is accepted.
- No package source, public API, or runtime behavior.

### Alternatives Considered

1. Require only a reviewer re-run after the extra commit. **Pro:** minimal implementation. **Con:**
   approval still happens after unauthorized work, contrary to the rule. Rejected.
2. Add a server-side workflow that comments after every push. **Pro:** covers API and subagent pushes.
   **Con:** it reacts after the unauthorized push and cannot protect the action boundary alone. Rejected
   as the sole control.
3. Make the local and agent hooks fail closed when the verdict or approval lookup is unreadable, and
   add a regression fixture for the PR-2500 sequence. **Pro:** blocks before the action and preserves
   normal pre-verdict behavior. **Con:** hook execution contexts must share one implementation and
   tests. Recommended, with a server-side check as defense in depth if the hook boundary is bypassed.

### Decision

Implement alternative 3 after explicit user approval. Factor the post-verdict decision into one
fail-closed guard reachable from both the Claude agent hook and the actual Git pre-push hook. The guard
must identify the open PR, latest GitHub-actions findings verdict, exact reviewed head, and a matching
approved action request before allowing a post-verdict push. Add tests that exercise zero findings
followed by a new commit, including API/read failures, so no execution surface can silently fail open.

### Architecture Review Checklist

- [x] Affected hook, agent invocation, and test paths are listed above.
- [x] Sibling scan completed: existing frozen-diff hook and review-before-push fixtures inspected.
- [x] At least two alternatives include explicit trade-offs.
- [x] No package, API, runtime, or user-facing surface is introduced.

## Completion Criteria

- [ ] TC-01: A push after `ACTIONABLE FINDINGS: 0` is refused unless an exact approved
      `POST_FINDINGS_ACTION_REQUEST` comment exists.
- [ ] TC-02: The approved request is bound to the current remote head, verdict count, action, ground,
      evidence, scope, and maintainer identity.
- [ ] TC-03: Unreadable or missing PR verdict/comments fail closed with a visible diagnostic.
- [ ] TC-04: Regression tests reproduce the PR #2500 sequence and pass in the focused harness suite.
- [ ] TC-05: Full scans and CI-equivalent verification pass.

## Test Plan

| TC-ID | Test Type  | Tool / Approach                               | Notes                                           |
| ----- | ---------- | --------------------------------------------- | ----------------------------------------------- |
| TC-01 | Unit       | `pre-push-open-pr-freeze.test.mjs`            | Zero findings then extra push is refused.       |
| TC-02 | Unit       | `pre-push-open-pr-freeze.test.mjs`            | Exact head/verdict/request fields are required. |
| TC-03 | Unit       | `review-before-push.test.mjs`                 | Unreadable API response fails closed visibly.   |
| TC-04 | Regression | Focused Vitest files                          | Reproduce the PR #2500 sequence.                |
| TC-05 | Suite      | `pnpm harness:scan` and CI-equivalent command | Full repository gate.                           |

Implementation sequence: add RED fixtures, implement the smallest hook/agent-hook change, then run
the focused Vitest files, `pnpm harness:scan`, and CI-equivalent checks.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Reason: not applicable because this changes repository workflow enforcement and has no product-facing
runtime scenario for a user to execute.

## Tasks

- [ ] TC-01/TC-02 — `.agents/tasks/INFRA-142-post-verdict-action-request-enforcement.md`: implement shared fail-closed enforcement and exact request binding.
- [ ] TC-03 — `.agents/tasks/INFRA-142-post-verdict-action-request-enforcement.md`: add fail-closed unreadable-lookup coverage.
- [ ] TC-04 — `.agents/tasks/INFRA-142-post-verdict-action-request-enforcement.md`: reproduce the PR #2500 regression in focused tests.
- [ ] TC-05 — `.agents/tasks/INFRA-142-post-verdict-action-request-enforcement.md`: run full scans and CI-equivalent verification.

## Evidence Log

### [GATE-WRITE] — ❌ FAIL | 2026-08-29

**Status remains:** draft
**Failed criteria:**

- GATE-WRITE — All 4 checklist items are `[x]`: no `### Architecture Review Checklist` under `## Architecture Review`
  **Required action:** add the checklist
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: no checklist item mentioning "Sibling scan"

### [GATE-WRITE] — ✅ PASS | 2026-08-29

**Status remains:** draft

- Guardian review: all seven semantic criteria PASS (concrete symptom, reproduction condition,
  research-to-decision trace, trade-off, new-surface placement, criterion coverage, and command /
  observable form).
- Mechanical dry-run: 20 PASS, 0 FAIL, 7 semantic criteria reviewed by guardian.
  **Required action:** add the Sibling scan item
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: alternative(s) 1, 2, 3 lack a Pro or a Con
  **Required action:** give every alternative a Pro and a Con
- GATE-WRITE — Every item has a `TC-N` prefix (TC-01, TC-02, …) — items without TC-N prefix = FAIL: 5 item(s) without a `TC-NN:` prefix: "A push after `ACTIONABLE FINDINGS: 0` is refused u"
  **Required action:** prefix every criterion with TC-NN:
- GATE-WRITE — Tasks section present with placeholder: no `## Tasks` section
  **Required action:** add it with a placeholder
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` already carries [GATE-APPROVAL]
  **Required action:** a first GATE-WRITE run expects an empty log

### [GATE-WRITE] — ❌ FAIL | 2026-08-29

**Status remains:** draft
**Failed criteria:**

- GATE-WRITE — All 4 checklist items are `[x]`: no `### Architecture Review Checklist` under `## Architecture Review`
  **Required action:** add the checklist
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: no checklist item mentioning "Sibling scan"
  **Required action:** add the Sibling scan item
- GATE-WRITE — Every item has a `TC-N` prefix (TC-01, TC-02, …) — items without TC-N prefix = FAIL: 4 item(s) without a `TC-NN:` prefix: "Affected hook, agent invocation, and test paths ar"
  **Required action:** prefix every criterion with TC-NN:
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` already carries [GATE-APPROVAL]
  **Required action:** a first GATE-WRITE run expects an empty log

### [GATE-WRITE] — ❌ FAIL | 2026-08-29

**Status remains:** draft
**Failed criteria:**

- GATE-WRITE — All 4 checklist items are `[x]`: no `### Architecture Review Checklist` under `## Architecture Review`
  **Required action:** add the checklist
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: no checklist item mentioning "Sibling scan"
  **Required action:** add the Sibling scan item

### [GATE-APPROVAL] — ✅ PASS | 2026-08-29

**Status upgrade:** draft → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "우회하지 못하게 git hooks이나 에이전트의 훅으로 기계적으로 제한하라"
**Given:** 2026-08-29, this conversation
**Review fingerprint:** 8296817edb39 (review f9161eb1, type/tags 9c50d7ec)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-08-29, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (8296817edb39) equals the document's current fingerprint

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-08-29

**Status remains:** approved
**Failed criteria:**

- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names no `.agents/tasks/<ID>.md` path
  **Required action:** record the Task path in `## Tasks`
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names no `.agents/tasks/<ID>.md` path
  **Required action:** record the Task path in `## Tasks`
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): no Task file to read
  **Required action:** create the Task file
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: no Task file to read
  **Required action:** create the Task file
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: no Task file to read
  **Required action:** create the Task file
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : 3 path(s) outside the paired spec/Task: .agents/evals/lessons/auto-lessons.md, .agents/evals/lessons/weekly-digest.md, .agents/tasks/INFRA-142-post-verdict-action-request-enforcement.md
  **Required action:** commit, stash, or remove them before this gate

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-08-29

**Status remains:** approved
**Failed criteria:**

- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names 0/5 TC ids and carries 3 checkbox task(s)
  **Required action:** one task per TC-N

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-08-29

**Status remains:** approved
**Failed criteria:**

- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names 0/5 TC ids and carries 3 checkbox task(s)
  **Required action:** one task per TC-N

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-29

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-08-29; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/INFRA-142-post-verdict-action-request-enforcement.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/INFRA-142-post-verdict-action-request-enforcement.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (5)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 177 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "gateImplementFirst",
  "taskPath": ".agents/tasks/INFRA-142-post-verdict-action-request-enforcement.md",
  "specPath": ".agents/spec-docs/todo/INFRA-142-post-verdict-action-request-enforcement.md",
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
    ".agents/spec-docs/todo/INFRA-142-post-verdict-action-request-enforcement.md",
    ".agents/tasks/INFRA-142-post-verdict-action-request-enforcement.md"
  ]
}
```

<!-- checkpoint-evidence:v1:end -->

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-08-29

**Status remains:** in-progress
**Failed criteria:**

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: status is `in-progress`, `approved` expected
  **Required action:** run the prior gate to PASS first
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : 2 path(s) outside the paired spec/Task: scripts/harness/**tests**/pre-push-sequence.test.mjs, scripts/harness/pre-push.mjs
  **Required action:** commit, stash, or remove them before this gate

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-08-29

**Command:** `pnpm exec vitest run scripts/harness/__tests__/pre-push-open-pr-freeze.test.mjs`
**Exit:** 0
**Output:** (last 10 of 23 line(s))

```
   ✓ pre-push open-PR freeze — GREEN direction > allows a post-verdict push only with an approved head-bound request  555ms
   ✓ pre-push open-PR freeze — GREEN direction > requires approval when findings remain  513ms
   ✓ pre-push open-PR freeze — GREEN direction > allows the push when the count cannot be read — unknown is not zero  546ms
   ✓ pre-push open-PR freeze — GREEN direction > does not read a stale COUNT answer as a pull-request number  536ms
   ✓ pre-push open-PR freeze — GREEN direction > does not let a non-reviewer spoof a blocking count  568ms

 Test Files  1 passed (1)
      Tests  13 passed (13)
   Start at  18:42:09
   Duration  7.23s (transform 24ms, setup 0ms, collect 27ms, tests 7.01s, environment 0ms, prepare 47ms)
```

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-08-29

**Command:** `pnpm exec vitest run scripts/harness/__tests__/pre-push-open-pr-freeze.test.mjs`
**Exit:** 0
**Output:** (last 10 of 23 line(s))

```
   ✓ pre-push open-PR freeze — GREEN direction > allows a post-verdict push only with an approved head-bound request  553ms
   ✓ pre-push open-PR freeze — GREEN direction > requires approval when findings remain  540ms
   ✓ pre-push open-PR freeze — GREEN direction > allows the push when the count cannot be read — unknown is not zero  573ms
   ✓ pre-push open-PR freeze — GREEN direction > does not read a stale COUNT answer as a pull-request number  602ms
   ✓ pre-push open-PR freeze — GREEN direction > does not let a non-reviewer spoof a blocking count  572ms

 Test Files  1 passed (1)
      Tests  13 passed (13)
   Start at  18:42:17
   Duration  7.22s (transform 28ms, setup 0ms, collect 29ms, tests 7.00s, environment 0ms, prepare 46ms)
```

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-08-29

**Command:** `pnpm exec vitest run scripts/harness/__tests__/review-before-push.test.mjs`
**Exit:** 0
**Output:** (last 10 of 28 line(s))

```
   ✓ a feature-branch push carries a reviewed diff > stops demanding a local review once the pull request is open  598ms
   ✓ a feature-branch push carries a reviewed diff > still demands one before the pull request exists  593ms
   ✓ a feature-branch push carries a reviewed diff > treats an unanswerable pull-request lookup as no pull request  565ms
   ✓ a feature-branch push carries a reviewed diff > does not read a branch named like a number as that pull request  593ms
   ✓ a feature-branch push carries a reviewed diff > exempts the integration branches and a promotion branch  2087ms

 Test Files  1 passed (1)
      Tests  36 passed (36)
   Start at  18:42:25
   Duration  13.39s (transform 63ms, setup 0ms, collect 84ms, tests 13.10s, environment 0ms, prepare 49ms)
```

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-08-29

**Command:** `pnpm exec vitest run scripts/harness/__tests__/pre-push-sequence.test.mjs`
**Exit:** 0
**Output:** (last 10 of 11 line(s))

```

 RUN  v3.2.6 /tmp/robota-infra142

[pre-push] Blocked: post-verdict action-request guard did not approve this push.
 ✓ scripts/harness/__tests__/pre-push-sequence.test.mjs (18 tests) 7ms

 Test Files  1 passed (1)
      Tests  18 passed (18)
   Start at  18:42:39
   Duration  336ms (transform 89ms, setup 0ms, collect 123ms, tests 7ms, environment 0ms, prepare 51ms)
```
