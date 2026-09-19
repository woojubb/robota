---
status: in-progress
type: BEHAVIOR
tags: [harness, cli]
lane: L2
---

# BEHAVIOR-2664: Make approval recording enforce prior-gate ordering

Paired with `.agents/tasks/BEHAVIOR-2664-make-approval-recording-enforce-prior-gate-ordering.md`.
Arising from [issue #2664](https://github.com/woojubb/robota/issues/2664).

## Problem

`node scripts/harness/gate.mjs approve` constructs a candidate `GATE-APPROVAL` PASS and sends that
candidate directly to `judgeCriteria(...)`. Unlike `runJudge`, `runApprove` never calls
`orderingResult(...)`, so it can persist a standing approval PASS when the document has no prior
`GATE-WRITE` PASS or is not in `review-ready` status.

The defect reproduces by running either a DIRECT or CLASS approval against a draft document, or against
a document whose Evidence Log lacks the catalogue-declared prior PASS. The command can report success
and mutate the Evidence Log even though a subsequent `judge --gate GATE-APPROVAL` would reject the same
ordering.

## Prior Art Research

Waived: this is a repository-private consistency repair between two command paths governed by the
existing local Prior-gate map. External product behavior cannot determine Robota's internal evidence-log
ordering contract; the authoritative prior art is the shared `orderingResult(...)` implementation and
the catalogue's `GATE-APPROVAL | GATE-WRITE | review-ready | recorded-pass` row.

## Architecture Review

### Affected Scope

- `scripts/harness/gate-operations.mjs` — approval recording and shared prior-gate evaluation.
- `scripts/harness/__tests__/gate.test.mjs` — DIRECT and CLASS approval-ordering regressions.
- `.agents/tasks/BEHAVIOR-2664-make-approval-recording-enforce-prior-gate-ordering.md` — execution record.
- `.agents/spec-docs/todo/BEHAVIOR-2664-make-approval-recording-enforce-prior-gate-ordering.md` — approved plan.

### Alternatives Considered

1. Evaluate `orderingResult(...)` in `runApprove` before persisting the candidate.
   - Pro: both sanctioned approval paths consume the catalogue's single ordering implementation, and an
     invalid early approval leaves the document recoverable for its first GATE-WRITE run.
   - Con: `runApprove` must distinguish the ordering precondition from the approval criteria it embeds in
     the eventual standing PASS.
2. Duplicate the expected prior gate and status checks inside `runApprove`.
   - Pro: the local change would be short and would not alter the candidate-judgement assembly.
   - Con: a second prior-gate implementation can drift from `recorded-pass` retry semantics and future
     catalogue changes.
3. Keep `approve` unchanged and require callers to run `judge --gate GATE-APPROVAL` afterwards.
   - Pro: no implementation change is required.
   - Con: the documented approval recorder can still create a false standing PASS, so skipped
     orchestration remains mechanically invisible.

### Decision

Choose alternative 1. `runApprove` will resolve the GATE-APPROVAL ordering through the same
`orderingResult(...)` path used by `runJudge`, against the in-memory candidate, before any write. An
ordering FAIL returns a deterministic non-zero refusal naming the missing prior PASS or expected status
and leaves the document byte-identical; only an ordering PASS may proceed to the existing mechanical
approval criteria and standing-entry write.

**Delivery mode:** `single`

Reachability is verified through `gate-cli.mjs`, which routes both DIRECT and CLASS `approve` invocations
to `runApprove`. Capability preservation keeps the route fields, verbatim instruction, measured CLASS
evidence, review fingerprint, and `recorded-pass` retry behavior unchanged. The adversarial cases are an
absent prior PASS, a prior PASS with the wrong current status, a later out-of-order GATE-WRITE FAIL after
the status-upgrading PASS, and both valid approval routes. No new package, app, interface surface, or
layer classification is introduced.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — `runJudge` and `runApprove` are the two gate-evaluation entry paths; both were inspected
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None

## Solution

1. Build the in-memory approval candidate exactly as today so route evidence and the review fingerprint
   remain the input to mechanical approval criteria.
2. Resolve GATE-APPROVAL from the catalogue and run `orderingResult(...)` on that candidate before any
   file write.
3. On ordering FAIL, return exit 1 with the shared observed reason and required action, without appending
   either PASS or FAIL evidence; this preserves the empty Evidence Log required by a future first
   GATE-WRITE run.
4. On ordering PASS, include its result in the accepted approval evidence and continue the existing
   DIRECT/CLASS mechanical judgement and persistence path.
5. Pin invalid and valid ordering cases in the gate test fixture, including `recorded-pass` behavior.

## Affected Files

- `scripts/harness/gate-operations.mjs`
- `scripts/harness/__tests__/gate.test.mjs`
- `.agents/tasks/BEHAVIOR-2664-make-approval-recording-enforce-prior-gate-ordering.md`
- `.agents/spec-docs/todo/BEHAVIOR-2664-make-approval-recording-enforce-prior-gate-ordering.md`

## Completion Criteria

- [ ] TC-01: Observable: DIRECT approval on a `draft` document with no GATE-WRITE PASS exits 1, names the absent prior PASS and expected `review-ready` status, and leaves the document byte-identical with no GATE-APPROVAL PASS.
- [ ] TC-02: Observable: approval with a recorded GATE-WRITE PASS but a non-`review-ready` current status exits 1, names the status mismatch, and leaves the document byte-identical.
- [ ] TC-03: Observable: review-ready documents with a valid status-upgrading GATE-WRITE PASS accept both DIRECT and CLASS routes while preserving their route evidence, review fingerprint, and catalogue `recorded-pass` behavior after a later out-of-order GATE-WRITE FAIL.
- [ ] TC-04: Command: `pnpm exec vitest run scripts/harness/__tests__/gate.test.mjs` exits 0.
- [ ] TC-05: Command: `node scripts/harness/run-all-scans.mjs --affected --context pr` exits 0 for the completed change.

## Test Plan

| TC-ID | Test Type   | Tool / Approach                                                      | Notes                                                                 |
| ----- | ----------- | -------------------------------------------------------------------- | --------------------------------------------------------------------- |
| TC-01 | unit        | gate fixture invoking DIRECT `approve` before GATE-WRITE             | Assert exit, diagnostic, byte identity, and absence of approval PASS. |
| TC-02 | unit        | gate fixture with prior PASS plus wrong current status                | Assert the shared ordering diagnostic and no write.                   |
| TC-03 | integration | DIRECT/CLASS fixtures plus the existing recorded-pass retry fixture   | Assert all approval evidence fields and retry semantics remain.       |
| TC-04 | integration | `pnpm exec vitest run scripts/harness/__tests__/gate.test.mjs`        | Focused gate behavior suite must exit 0.                              |
| TC-05 | integration | `node scripts/harness/run-all-scans.mjs --affected --context pr`      | Repository harness verification must exit 0.                         |

## User Execution Test Scenarios

Not applicable.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This change affects a private repository gate command and has no Robota product CLI, TUI,
browser, public SDK, or installed-package interaction for an end user.

## Tasks

Paired execution record:
`.agents/tasks/BEHAVIOR-2664-make-approval-recording-enforce-prior-gate-ordering.md`.

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-09-20

**Status upgrade:** draft → review-ready

- GATE-WRITE — Ordering: PASS — this is the entry gate, so no prior status gate is required; the
  document declares `status: draft`, sits in `.agents/spec-docs/draft/`, and its Evidence Log was empty
  before this entry. `git status --short` showed only this untracked spec, with no implementation or test
  changes ahead of the gate.
- GATE-WRITE — File begins with `---` YAML frontmatter block: PASS — the first line is `---` and the
  closing delimiter precedes the title.
- GATE-WRITE — `status: draft` present in frontmatter: PASS — frontmatter declares exactly
  `status: draft`.
- GATE-WRITE — `type:` is one allowed value: PASS — `type: BEHAVIOR` is in the catalogue's 11-value
  list.
- GATE-WRITE — `tags:` field present: PASS — `tags: [harness, cli]` is present and non-empty.
- GATE-WRITE — Concrete symptom: PASS — the Problem names the exact `gate.mjs approve` command path
  and the wrong observable behavior: `runApprove` can persist a standing `GATE-APPROVAL` PASS without
  the required prior `GATE-WRITE` PASS or `review-ready` status.
- GATE-WRITE — Reproduction condition: PASS — the Problem states that either DIRECT or CLASS approval
  against a draft document, or a document lacking the declared prior PASS, reproduces the invalid
  successful write.
- GATE-WRITE — No `TBD`, `TODO`, or vague single-sentence Problem: PASS — the Problem contains four
  concrete sentences and neither banned marker.
- GATE-WRITE — Prior Art Research section present: PASS — `## Prior Art Research` is present.
- GATE-WRITE — Prior Art Research substantiated or waived: PASS — the section explicitly records a
  repository-private consistency-repair waiver and names the local authoritative references:
  `orderingResult(...)` and the catalogue's `GATE-APPROVAL | GATE-WRITE | review-ready |
  recorded-pass` row.
- GATE-WRITE — Explicit `Waived: <reason>` line: PASS — the waiver explains why external product
  behavior cannot govern this repository's internal evidence-log ordering contract.
- GATE-WRITE — Research feeds Alternatives Considered / Decision: PASS — the identified shared
  `orderingResult(...)` implementation and catalogue row directly distinguish the chosen reuse option
  from duplicated checks and from leaving the approval recorder independently permissive.
- GATE-WRITE — All four Architecture Review checklist items checked: PASS — 4/4 entries are `[x]`.
- GATE-WRITE — Sibling scan completed with evidence: PASS — the checked item identifies `runJudge` and
  `runApprove` as the two inspected gate-evaluation entry paths; both functions exist in
  `scripts/harness/gate-operations.mjs`.
- GATE-WRITE — Alternatives Considered: PASS — three numbered alternatives each include a Pro and a
  Con.
- GATE-WRITE — Decision references the driving trade-off: PASS — it chooses alternative 1's shared
  ordering implementation, accepting the need to distinguish the ordering precondition from embedded
  approval criteria in exchange for avoiding a second, drift-prone prior-gate implementation and false
  standing PASS writes.
- GATE-WRITE — New-surface placement: N/A — the Decision explicitly states that no new package, app,
  interface surface, or layer classification is introduced; the change is confined to existing
  approval behavior and its existing test fixture.
- GATE-WRITE — Every Completion Criteria item has a `TC-N` prefix: PASS — five criteria are numbered
  `TC-01` through `TC-05`.
- GATE-WRITE — At least one criterion per distinct feature or sub-item: PASS — TC-01 covers absent
  prior-PASS refusal and byte identity; TC-02 covers wrong-status refusal; TC-03 covers both valid routes,
  preserved evidence/fingerprint, and `recorded-pass` retry behavior; TC-04 and TC-05 cover focused and
  repository verification commands.
- GATE-WRITE — Command or Observable form: PASS — TC-01 through TC-03 use explicit Observable form and
  name exit status, diagnostics, mutation boundaries, and preserved fields; TC-04 and TC-05 use explicit
  Command form with exit 0.
- GATE-WRITE — No banned completion language: PASS — none of `works correctly`, `no errors`,
  `implemented`, or `displays correctly` appears in Completion Criteria.
- GATE-WRITE — Test Plan section present: PASS — `## Test Plan` is present.
- GATE-WRITE — Test Plan count matches Completion Criteria: PASS — five Test Plan rows match five
  `TC-NN` criteria one-for-one.
- GATE-WRITE — Test Type and Tool / Approach populated: PASS — all five rows contain both fields and no
  row contains `TBD`.
- GATE-WRITE — Manual-test justification: N/A — zero rows use `manual` as the Tool / Approach.
- GATE-WRITE — Tasks section present with placeholder: PASS — `## Tasks` records the paired execution
  path `.agents/tasks/BEHAVIOR-2664-make-approval-recording-enforce-prior-gate-ordering.md`.
- GATE-WRITE — Evidence Log present and empty on first run: PASS — the section existed with zero prior
  entries before this verdict was appended.
- GATE-WRITE — No body `## Status` or `## Classification` sections: PASS — neither heading appears.
- GATE-WRITE — Mechanical evaluation: PASS —
  `node scripts/harness/gate.mjs judge --gate GATE-WRITE --doc .agents/spec-docs/draft/BEHAVIOR-2664-make-approval-recording-enforce-prior-gate-ordering.md --dry-run`
  reported `27 criteria judged — 20 PASS, 0 FAIL, 7 PENDING-GUARDIAN`; the seven pending items were
  exactly the catalogue's semantic criteria and the dry run wrote no entry.
- GATE-WRITE — Semantic evaluation: PASS — all seven semantic criteria were evaluated above; six pass
  and new-surface placement is explicitly N/A with its reason stated.

**Judged by:** `backlog-gate-guard` (semantic) + `gate.mjs` (mechanical)
**Judged at:** HEAD `5356cd7cd55cb3b4a5b6c75feaedbaa24d17ba21` · base `origin/develop@c81dd4ff75695e3f6a72566d4b3256f42e6479e7` · document `.agents/spec-docs/draft/BEHAVIOR-2664-make-approval-recording-enforce-prior-gate-ordering.md` blob `3d64ffdabf8ad83323f4f168de47636c560a9f4f` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-20

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인합니다. 그리고 앞으로 타당한 근거와 함께 추천안을 제시하면 근거가 타당할 경우 자동으로 승인합니다."
**Given:** 2026-09-20, this conversation
**Review fingerprint:** 922952054b20 (review 03b41389, type/tags 32461feb)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-20, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (922952054b20) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `5356cd7cd55c` · base `origin/develop@c81dd4ff7569` · document `.agents/spec-docs/backlog/BEHAVIOR-2664-make-approval-recording-enforce-prior-gate-ordering.md` blob `fdd78b178e95` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-20

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인합니다. 그리고 앞으로 타당한 근거와 함께 추천안을 제시하면 근거가 타당할 경우 자동으로 승인합니다."
**Given:** 2026-09-20, this conversation
**Review fingerprint:** 922952054b20 (review 03b41389, type/tags 32461feb)

- GATE-APPROVAL — Ordering: PASS — the recorded `GATE-WRITE` PASS upgraded `draft → review-ready`,
  which equals the document's current `status: review-ready`; under this row's catalogue-declared
  `recorded-pass` rule, that status-upgrading PASS remains sufficient even if a later out-of-order
  GATE-WRITE entry exists.
- GATE-APPROVAL — User has provided explicit approval in the current conversation: PASS — route
  `DIRECT`; the standing entry records the verbatim instruction above with the date and session.
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS —
  the first-person statement `승인합니다.` explicitly means "I approve," and the `DIRECT` approval
  record binds that instruction to this document rather than relaying approval of another item.
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry
  predates this approval: N/A — route `DIRECT` invokes no delegated class.
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it
  was given in: N/A to Route CLASS — route `DIRECT` invokes no class; the required DIRECT evidence is
  nevertheless present above as the verbatim instruction, `2026-09-20`, and `this conversation`.
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by
  assertion: N/A — route `DIRECT` invokes no class or class evidence condition.
- GATE-APPROVAL — The item is inside the class as the registry defines it: N/A — route `DIRECT`
  invokes no delegated class, so no class boundary applies.
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: PASS — the
  recorded review fingerprint `922952054b20` equals the document's current fingerprint, including
  review `03b41389` and type/tags `32461feb`.
- GATE-APPROVAL — Independent architecture validation: N/A — the Decision explicitly states that the
  spec introduces no new package, app, interface surface, or layer/product-family reclassification;
  therefore no independent placement verdict is required.
- GATE-APPROVAL — Pre-approval implementation check: PASS — `git status --short` showed only this
  untracked spec document, with no implementation or test changes, and `git diff` for
  `scripts/harness/gate-operations.mjs` and `scripts/harness/__tests__/gate.test.mjs` was empty.

**Judged by:** `backlog-gate-guard` (semantic) + `gate.mjs` (mechanical)
**Judged at:** HEAD `5356cd7cd55cb3b4a5b6c75feaedbaa24d17ba21` · base `origin/develop@c81dd4ff75695e3f6a72566d4b3256f42e6479e7` · document `.agents/spec-docs/backlog/BEHAVIOR-2664-make-approval-recording-enforce-prior-gate-ordering.md` blob `0912861c241178324af5e5e8bb8c5e5742a62e35` (untracked)

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-09-20

**Status remains:** approved
**Failed criteria:**

- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names 4/5 TC ids and carries 4 checkbox task(s)
  **Required action:** one task per TC-N

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `7e5a5643aa67` · base `origin/develop@c81dd4ff7569` · document `.agents/spec-docs/todo/BEHAVIOR-2664-make-approval-recording-enforce-prior-gate-ordering.md` blob `d706dcbaf8ed` (tracked)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-20

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-20; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/BEHAVIOR-2664-make-approval-recording-enforce-prior-gate-ordering.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/BEHAVIOR-2664-make-approval-recording-enforce-prior-gate-ordering.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (5)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 291 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->
```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/BEHAVIOR-2664-make-approval-recording-enforce-prior-gate-ordering.md",
  "specPath": ".agents/spec-docs/todo/BEHAVIOR-2664-make-approval-recording-enforce-prior-gate-ordering.md",
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
    ".agents/spec-docs/todo/BEHAVIOR-2664-make-approval-recording-enforce-prior-gate-ordering.md",
    ".agents/tasks/BEHAVIOR-2664-make-approval-recording-enforce-prior-gate-ordering.md"
  ]
}
```
<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `7e5a5643aa67` · base `origin/develop@c81dd4ff7569` · document `.agents/spec-docs/todo/BEHAVIOR-2664-make-approval-recording-enforce-prior-gate-ordering.md` blob `b845aa6a86e0` (modified)
