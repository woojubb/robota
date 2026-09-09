---
status: in-progress
type: AGREEMENT
tags: [process, github, intake, measurement]
lane: L2
---

# AGREEMENT-2515: coordinate rolling throughput measurement and bounded intake policy

Paired with `.agents/tasks/AGREEMENT-2515-coordinate-rolling-throughput-measurement-and-bounded-intake-policy.md`. Arising from [issue #2515](https://github.com/woojubb/robota/issues/2515).

## Problem

On a clean checkout at `origin/develop` (`fe4c0aa5c92889377991c0c41b396b4addea2a8a`), the canonical
measurement requested by GitHub issue #2515 cannot be run: `node scripts/harness/issue-throughput.mjs
--repo woojubb/robota --window 168h` fails because that command is absent. Operators therefore fall
back to ad-hoc `gh` queries that do not guarantee one `[start,end)` boundary, pagination rule, timezone
presentation, or failure result, while no checked-in policy changes filing when net growth is positive.
This happens whenever a session audits the open issue queue from the current integration branch. Keep
GitHub issue #2515 as the single external problem record while decomposing the two independent causes
into executable Tasks: a canonical rolling measurement and a bounded policy for non-blocking filing.
The parent owns the shared metric envelope, the child relationship, and the final external lifecycle
decision; it does not absorb the separate nested-command ownership defect in issue #2580.

<!-- Symptom + reproduction condition: the command, the output that is wrong, and when it occurs.
     Replace the seed above if it does not name both. -->

## Prior Art Research

Waived: User explicitly authorized omitting non-essential procedure for urgent execution; repository issue, current rules, and existing triage implementation are sufficient for this internal governance plan.

## Architecture Review

### Affected Scope

- `.agents/tasks/AGREEMENT-2515-coordinate-rolling-throughput-measurement-and-bounded-intake-policy.md`
- `.agents/tasks/OBSERVABILITY-2515-measure-rolling-issue-throughput-with-canonical-boundaries.md`
- `.agents/tasks/RULE-2515-bound-non-blocking-issue-intake-by-measured-net-growth.md`
- `scripts/harness/github-issue-triage.mjs` and its existing RULE-019 ownership
- The checked-in intake policy/rule owner identified by the child specs
- GitHub issue #2515's external Issue/Task map; issue #2580 remains out of scope

### Alternatives Considered

1. Treat measurement and bounded intake as one implementation Task.
   - Pro: one PR and one apparent completion decision.
   - Con: independent causes, owners, and failure policies become inseparable; a partial delivery can
     appear complete and the issue's acceptance criteria cannot be judged independently.
2. Add a separate GitHub child Issue for each cause.
   - Pro: separate external discussion threads and release tracking.
   - Con: neither cause has an independent external lifecycle; it duplicates queue state and violates
     the child-Issue exception rule.
3. Create one parent AGREEMENT Task with two internal child Tasks and paired child specs.
   - Pro: preserves one external problem record while giving measurement and policy independent gates,
     tests, and completion decisions; shared semantics remain explicit in the parent.
   - Con: adds planning records and requires the parent to reconcile both child outcomes at the end.

### Decision

Choose alternative 3. The two independent reviews on 2026-09-09 classified the problem as FOUNDATIONAL
and identified separate measurement/observability and intake-control causes. The parent is reachable by
both child Tasks, preserves existing RULE-019/triage capabilities, and deliberately does not absorb the
nested executable-command ownership defect in issue #2580. The adversarial pass is the explicit check
against metric gaming, API boundary/pagination errors, silent failure, issue suppression, and scope
leakage; each is assigned to a child criterion or retained as a separate issue.

**Delivery mode:** `single`

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: User explicitly authorized omitting non-essential procedure for urgent execution; repository issue, current rules, and existing triage implementation are sufficient for this internal governance plan.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

None

## Solution

1. Keep GitHub issue #2515 open as the canonical external record and update its body with the exact
   parent/child Task map after the local manifest is committed.
2. Use `OBSERVABILITY-2515` to define the shared `[start,end)` UTC envelope, issue qualification,
   pagination, display semantics, count fields, and failure-visible result contract.
3. Use `RULE-2515` to define the measurable positive-net threshold, slow/stop/group response, and
   immediate-file risk exceptions while reusing the existing triage owner.
4. Complete the parent only after both children are terminal, the complete acceptance criteria are
   evidenced, and issue #2515 plus related issue dispositions have been audited. Never close issue #2512,
   issue #2580, or distinct siblings merely because this parent is complete.

## Affected Files

- `.agents/tasks/AGREEMENT-2515-coordinate-rolling-throughput-measurement-and-bounded-intake-policy.md`
- `.agents/tasks/OBSERVABILITY-2515-measure-rolling-issue-throughput-with-canonical-boundaries.md`
- `.agents/tasks/RULE-2515-bound-non-blocking-issue-intake-by-measured-net-growth.md`
- `scripts/harness/github-issue-triage.mjs` only where the child spec proves the existing owner is the
  correct enforcement seam
- The child-owned measurement and policy test fixtures/files, to be named before their implementation

## Completion Criteria

- [ ] TC-01: The parent and both child Tasks cite GitHub issue #2515, have exact IDs/paths/statuses, and
      issue #2515 has one readable parent Task marker plus its priority label removed only after read-back.
- [ ] TC-02: Both child specs use the same explicit `[start,end)` UTC metric envelope and preserve the
      existing triage/label ownership without absorbing issue #2580.
- [ ] TC-03: The parent evidence records independent child verification, affected scans, final issue
      state, and a related-issue audit that leaves retained issues open and closes only truthful terminal
      dispositions.

## Test Plan

| TC-ID | Test Type | Tool / Approach                             | Notes                                             |
| ----- | --------- | ------------------------------------------- | ------------------------------------------------- |
| TC-01 | Contract/process | `github-issue-triage.mjs convert` plus GitHub read-back | Exact Task map and marker/label ordering |
| TC-02 | Architecture/process | Child spec review and shared-fixture assertions | One metric owner; no scope leakage |
| TC-03 | Integration/process | Child change loops, harness scans, and post-merge issue audit | Parent completion only after both children |

## User Execution Test Scenarios

Not applicable — this parent owns decomposition and the shared boundary; the child Tasks own the
canonical command and policy-enforcement scenarios. Verification evidence is recorded in the child
plans and reconciled here.

Recorded as the rule's required choice rather than skipped.

## Tasks

- [ ] AGREEMENT-2515 — todo — `.agents/tasks/AGREEMENT-2515-coordinate-rolling-throughput-measurement-and-bounded-intake-policy.md`

## Evidence Log

### [GATE-WRITE] — ❌ FAIL | 2026-09-09

- Findings: the Problem lacked a concrete symptom and reproduction condition.
- Standing authorization: “시급도가 높고 신속하게 처리하기 위해 많은 절차를 생략해도 됩니다.”
- Bounded correction: add only the exact absent-command symptom and clean-checkout reproduction
  condition; preserve the approved decomposition, alternatives, scope, and completion criteria.

### [GATE-WRITE] — ✅ PASS | 2026-09-09

- Mechanical gate: 20 PASS, 0 FAIL; the staged atomic AGREEMENT manifest has exactly one new parent,
  one paired draft spec, and the two declared todo child Tasks.
- Semantic guard: concrete absent-command symptom and clean-checkout reproduction condition PASS;
  research waiver, alternatives/decision trade-off, scope boundary, and TC/Test Plan coverage PASS.
- GATE-WRITE — concrete symptom: PASS — absent canonical command and wrong observable state are named.
- GATE-WRITE — reproduction condition: PASS — clean `origin/develop` queue audit is named.
- GATE-WRITE — structure and criteria: PASS — mechanical and remaining semantic criteria pass.
**Status upgrade:** draft → review-ready

### [GATE-APPROVAL] — ✅ PASS | 2026-09-09

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "완료 작업 해줘"
**Given:** 2026-09-09, this conversation
**Review fingerprint:** ac7718859edc (review 7174fc3e, type/tags cf9e316b)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-09, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (ac7718859edc) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `fe4c0aa5c928` · base `origin/develop@fe4c0aa5c928` · document `.agents/spec-docs/backlog/AGREEMENT-2515-coordinate-rolling-throughput-measurement-and-bounded-intake-policy.md` blob `4e19947a618f` (modified)

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-09-09

**Status remains:** approved
**Failed criteria:**

- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/OBSERVABILITY-2515-measure-rolling-issue-throughput-with-canonical-boundaries.md`, whose basename is not the spec's (AGREEMENT-2515-coordinate-rolling-throughput-measurement-and-bounded-intake-policy.md)
  **Required action:** pair the Task and the spec by basename
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` carries no `**Author verdict:** `SCENARIO DRAFTED: (not-applicable|automatable|manual) | <n>`` line (0 found, exactly 1 required)
  **Required action:** record the author verdict in the Task
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : 1 path(s) outside the paired spec/Task: .agents/spec-docs/draft/OBSERVABILITY-2515-measure-rolling-issue-throughput-with-canonical-boundaries.md
  **Required action:** commit, stash, or remove them before this gate

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `a434dd94c8e5` · base `origin/develop@fe4c0aa5c928` · document `.agents/spec-docs/todo/AGREEMENT-2515-coordinate-rolling-throughput-measurement-and-bounded-intake-policy.md` blob `e4b486c526b9` (tracked)

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-09-09

**Status remains:** approved
**Failed criteria:**

- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names 0/3 TC ids and carries 2 checkbox task(s)
  **Required action:** one task per TC-N

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `a434dd94c8e5` · base `origin/develop@fe4c0aa5c928` · document `.agents/spec-docs/todo/AGREEMENT-2515-coordinate-rolling-throughput-measurement-and-bounded-intake-policy.md` blob `80847a7fdc07` (modified)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-09

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-09; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/AGREEMENT-2515-coordinate-rolling-throughput-measurement-and-bounded-intake-policy.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/AGREEMENT-2515-coordinate-rolling-throughput-measurement-and-bounded-intake-policy.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (3)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 386 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->
```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/AGREEMENT-2515-coordinate-rolling-throughput-measurement-and-bounded-intake-policy.md",
  "specPath": ".agents/spec-docs/todo/AGREEMENT-2515-coordinate-rolling-throughput-measurement-and-bounded-intake-policy.md",
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
    }
  ],
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/spec-docs/todo/AGREEMENT-2515-coordinate-rolling-throughput-measurement-and-bounded-intake-policy.md",
    ".agents/tasks/AGREEMENT-2515-coordinate-rolling-throughput-measurement-and-bounded-intake-policy.md"
  ]
}
```
<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `a434dd94c8e5` · base `origin/develop@fe4c0aa5c928` · document `.agents/spec-docs/todo/AGREEMENT-2515-coordinate-rolling-throughput-measurement-and-bounded-intake-policy.md` blob `ad227135a407` (modified)
