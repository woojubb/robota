---
status: in-progress
type: FLOW
tags: [workflow, harness]
lane: L2
---

# PROC-017: Combine issue conversion, PLAN, and implementation into one PR lifecycle

Paired with `.agents/tasks/PROC-017-combine-issue-conversion-approved-plan-and-implementation-into-one-ordered-pr-li.md`. Arising from [issue #2514](https://github.com/woojubb/robota/issues/2514).

## Problem

For an eligible accepted Issue, the current process pays for a conversion PR and then a separate
implementation PR before the product code changes. issue #2512 re-read the representative issue #2082 evidence:
23m 14s from conversion start to merge, 11m 34s of PR-open remote wait, and 44m 48s observed before
implementation with zero runtime source changes. The exact queue measurements in issue #2512 show this is
one contributor to a systemic throughput problem, not the whole initiative.

Reproduction: follow `.agents/skills/issue-to-backlog/SKILL.md` through
`node scripts/harness/github-issue-triage.mjs convert`, then the current
`.agents/skills/user-request-gate/SKILL.md` planning flow; conversion is finalized before an
implementation branch/PR can begin, so the same eligible Issue pays two PR lifecycles.

The required outcome is one ordered topic branch and one PR, while preserving the existing
fail-closed boundary: a valid Issue conversion receipt and approved PLAN checkpoint must be ancestors
of every implementation change, and review, CI, merge verification, and final issue writeback remain
independent gates.

## Prior Art Research

The repository already owns each primitive: `allocate-work-item-id.mjs` creates collision-safe Task
records, `new-spec.mjs` creates paired spec drafts, `github-issue-triage.mjs` performs Issue marker
write/read-back and priority removal, `gate.mjs` owns gate evidence and transitions, and
`scan-user-execution-plan-order.mjs` proves checkpoint ancestry. `backlog-pipeline` and
`backlog-execution-orchestrator` own sequencing. PROC-016, INFRA-140, INFRA-141, HARNESS-121, and
HARNESS-131 are local precedents for lane gating, evidence binding, atomic conversion, and plan order.

No existing command composes these primitives into a resumable single-PR lifecycle. The design must
extend the owners rather than duplicate their semantics. Comparable external workflow automation is
not authoritative for Robota's fail-closed contract. No comparable external reference found: none
matches this repository's Issue writeback, Task/spec ancestry, and independent gate contract, so no
external citation supplies a reason to weaken the repository's own gates.

## Architecture Review

### Affected Scope

- `.agents/rules/backlog-execution.md` — lifecycle and PR-unit policy
- `.agents/skills/issue-to-backlog/SKILL.md` — conversion boundary and eligibility
- `.agents/skills/backlog-execution-orchestrator/SKILL.md` — ordered phase composition
- `.agents/skills/user-request-gate/SKILL.md` — one-branch conversion-to-implementation route
- `scripts/harness/scan-user-execution-plan-order.mjs` — mechanical conversion/PLAN/implementation ordering guard
- `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs` — conversion-before-checkpoint fixtures
- `scripts/harness/__tests__/proc-017-affected-paths.test.mjs` — deterministic affected-path classification fixture
- `scripts/harness/record-pr-lifecycle-measurement.mjs` — read-only lifecycle evidence recorder
- `scripts/harness/compare-pr-lifecycle-measurements.mjs` — lifecycle evidence comparator
- `scripts/harness/__tests__/pr-lifecycle-measurement.test.mjs` — measurement comparison fixtures
- `scripts/harness/__tests__/record-pr-lifecycle-measurement.test.mjs` — recorder boundary fixture
- `scripts/harness/__tests__/compare-pr-lifecycle-measurements.test.mjs` — comparator boundary fixture
- `scripts/harness/conversion-evidence.mjs` — pure parser and subject/eligibility binding
- `scripts/harness/__tests__/conversion-evidence.test.mjs` — contract and refusal fixtures

Placement: this is a repository workflow/harness capability in the existing `backlog-pipeline` family,
not a `packages/` runtime API or a new product surface. The closest structural analog is the existing
plan-order scanner and its tests; the change extends that owner rather than creating a sibling command
or coupling workflow state to a product package. No package ownership or dependency direction changes.

### Alternatives Considered

1. Keep conversion and implementation as separate branches/PRs.
   - Pro: preserves today's familiar boundaries.
   - Con: retains the measured duplicated remote lifecycle and synchronization cost.
2. Use one ordered topic branch with distinct conversion, PLAN, implementation, and verification
   commits, then one PR.
   - Pro: removes the duplicate PR lifecycle while retaining ancestry and independent gates.
   - Con: requires an explicit resumable boundary between remote Issue state and local commits.
3. Collapse conversion and planning into an opaque automation step or bypass checkpoint checks.
   - Pro: shortest apparent path.
   - Con: loses auditability and fail-closed protection; rejected.

### Decision

Choose alternative 2, implemented as a procedural route plus a mechanical ancestry guard rather than a
new product or lifecycle-coordinator command. The two measurement scripts named in TC-06 are
non-authoritative, measurement-only evidence tools; they do not mutate Issues, create Tasks, or gate
delivery. Existing triage, spec, gate, plan-order, review, CI, merge-verifier,
and issue-writeback owners remain authoritative. GitHub state is not described as an atomic transaction
with Git: each remote mutation is confirmed by read-back, failures stop the lifecycle, and the exact
Task marker/comment URL is carried into the planning evidence before implementation. Existing triage
idempotency prevents duplicate Tasks/comments/labels; the branch ancestry guard prevents a missing or
retrospective PLAN from authorizing implementation.

**Continuation artifacts:** `.agents/evidence/PROC-017-candidate.json`, `.agents/loop-runs/pr-finding-resolution-loop.jsonl`, `.agents/skills/backlog-execution-orchestrator/SKILL.md`, `.agents/skills/user-request-gate/SKILL.md`, `scripts/harness/__tests__/conversion-evidence.test.mjs`, `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs`

Eligibility is limited to a triaged single-cause P0/P1 Issue with one work-kind label, no existing
Task marker, no security/data-correctness claim, no user-owned product/contract decision, no separate
child-issue requirement, and a scope that can pass one recommendation and one verification plan.
Malformed, untriaged, already-converted, security/data-correctness, user-decision, or multi-owner
inputs are refused before mutation.

Eligibility matrix:

| Input observation                                                                                     | Decision                                           | Evidence/owner                               |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------- | -------------------------------------------- |
| exactly one `enhancement`, open, exactly one `priority:P0` or `priority:P1`, no `status:needs-triage` | eligible candidate                                 | `github-issue-triage.mjs audit` + issue JSON |
| `bug` or `documentation`                                                                              | existing guarded route; not this child             | issue-to-backlog classification              |
| zero/multiple work-kind or priority labels, intake marker present, or closed                          | refuse                                             | triage audit exit/non-zero report            |
| existing exact `robota-task` marker                                                                   | resume only the named Task; never allocate another | marker read-back                             |
| security/data-correctness, user-owned product/contract choice, or multiple independent causes/owners  | refuse and route to user/child issue               | recommendation/depth verdict                 |
| single cause but published contract or package ownership/dependency change                            | refuse this fast path; use normal L2 approval      | spec-workflow lane/approval                  |

Manual resume state is already durable and subject-bound: the exact Issue marker/comment URL is recorded
in the Task's one `Conversion evidence:` line, the exact `baseOid`/branch and planning checkpoint SHA
are recorded in the committed Task/spec gate entries, and the existing PR/review/merge records carry
head/base/merge identity. A retry rereads these three owners in order and resumes only an exact subject
match. A missing, partial, or mismatched record fails closed. This deliberately uses existing durable
records instead of introducing a second phase-state database.

The exact conversion-evidence grammar is:

`Conversion evidence: issue=https://github.com/woojubb/robota/issues/<N>; task=<ID>; marker=https://github.com/woojubb/robota/issues/<N>#issuecomment-<ID>; marker-readback=<UTC ISO-8601>; priority-removed=<UTC ISO-8601>; base=<ref>; base-oid=<40-hex>`.

The plan-order guard imports `parseConversionEvidence` before accepting the planning checkpoint and
compares the Issue number, Task ID/path, marker Issue number, and base OID against
the current Task/spec and branch. It refuses zero or multiple lines, malformed URLs/timestamps, a
marker for another Issue/Task, a missing priority-removal timestamp, or a base OID not reachable from
the declared base. Triage owns whether the marker was actually read back and the priority removed; the
guard consumes the recorded evidence and never synthesizes it.

After a crash following priority removal but before the planning checkpoint, rerun triage read-only. An
exact marker resumes at the existing Task/spec pair; the missing evidence line is written once before
PLAN. If the marker, Task path, Issue, or base identity differs, the run stops for human reconciliation.
No second Task/spec/comment/label/branch/PR is created.

The exact eligibility grammar is:

`Combined lifecycle eligibility: eligible; work-kind=enhancement; priority=<P0-or-P1>; issue-state=OPEN; child-causes=0; security=none; data-correctness=none; user-decision=none; contract-change=none; owner-count=1`.

`<P0-or-P1>` is exactly one literal value, either `P0` or `P1`; it is not the literal string
`P0|P1`. The parser has separate eligible P0 and eligible P1 fixtures and refusal fixtures for
every other work-kind, priority, state, marker, cause, security, data-correctness, user-decision,
contract-change, and owner-count value.

`conversion-evidence.mjs` parses both lines, validates the Issue number and Task ID against the paired
record, and returns structured `eligible`, `conversion`, or `refused` results. Its public parser
boundary is `parseConversionEvidence({ taskText, specText, issueNumber, taskId, baseOid })`; it never calls GitHub,
allocates a Task, removes a label, creates a branch, or opens a PR. The triage command supplies the
remote marker/read-back fact; the recommendation gate supplies eligibility; the parser only prevents a
later checkpoint from accepting an absent, duplicated, malformed, or cross-subject claim.

Recovery is a deterministic transition table, not an inferred phase:

| Existing state                                           | Retry action                                                            | Refusal                                           |
| -------------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------- |
| no marker / no Task                                      | run normal triage conversion once                                       | any existing local pair with different Issue/Task |
| exact marker + Task, P label present                     | re-read marker, then remove only that P label                           | marker read-back failure                          |
| exact marker + Task, P label absent, no eligibility line | append one eligibility line and one conversion line; stop for PLAN gate | mismatched identity or duplicate lines            |
| exact evidence + eligible line, no checkpoint            | run recommendation/scenario/PLAN gates; create checkpoint only on PASS  | missing endorsement, scenario, or gate PASS       |
| checkpoint exists                                        | implementation may begin only if scanner proves ancestor                | retrospective or unrelated checkpoint             |

Ordered state:

`eligible Issue → Task/spec creation → Issue marker read-back → priority-label removal → endorsed
recommendation + scenario PLAN → GATE-IMPLEMENT/PLAN checkpoint commit → implementation → final
verification → one PR → independent review/CI/thread resolution → merge verification → final Issue
writeback`.

Crash/retry rules: a missing or unreadable marker/read-back blocks the next phase; an existing exact
marker resumes at the existing Task/spec pair; a mismatched subject, head, base, or input identity
refuses; no step silently advances on an error.

Coordinator boundary and owner map:

| Owner                                          | Owns                                                  | Coordinator may do                        |
| ---------------------------------------------- | ----------------------------------------------------- | ----------------------------------------- |
| `issue-to-backlog`                             | cause grouping and Task/spec creation                 | invoke it and persist exact paths         |
| `github-issue-triage.mjs`                      | live labels, marker write/read-back, priority removal | invoke idempotently and require read-back |
| `gate.mjs` / `backlog-pipeline`                | gate evidence and status transitions                  | invoke, never synthesize a PASS           |
| `scan-user-execution-plan-order.mjs`           | checkpoint ancestry and implementation ordering       | require its result before implementation  |
| `backlog-execution-orchestrator`               | phase routing and stop conditions                     | expose phase state, never bypass a phase  |
| PR review, CI, merge verifier, issue writeback | independent delivery guardians                        | wait for and record their result only     |

The coordinator owns no gate criteria, Task/spec contents, implementation, or merge authority.

The durable conversion receipt is the existing idempotent GitHub Task marker read back by
`github-issue-triage.mjs`; the local Task/spec planning pair records its exact marker and issue URL.
The mechanical guard binds that pair to the first planning checkpoint and refuses implementation paths
before the checkpoint. No second receipt format or coordinator state machine is introduced, avoiding a
second owner for remote state.

| Phase                 | Entry guard                                                 | Success receipt                      | Crash/retry behavior                           |
| --------------------- | ----------------------------------------------------------- | ------------------------------------ | ---------------------------------------------- |
| eligibility           | exact work-kind + P0/P1, open, no marker, eligible claim    | triage pass                          | re-read; mismatch refuses                      |
| task/spec             | allocator and spec pair return exact paths                  | exact Task/spec pair                 | exact existing pair resumes; mismatch refuses  |
| writeback             | marker write/read-back succeeds                             | Task marker URL in planning evidence | unreadable state blocks                        |
| priority removal      | marker receipt is valid                                     | priority label removed and re-read   | remove only exact P label                      |
| PLAN/checkpoint       | endorsed recommendation, scenario PLAN, GATE-IMPLEMENT PASS | checkpoint commit SHA                | absent or retrospective checkpoint blocks      |
| implementation/verify | checkpoint ancestor and normal engineering gates            | existing gate evidence               | no later phase is authorized on failure        |
| PR/review/merge       | final head/base identities and all guardians pass           | PR/merge verification                | stale head/base or open threads blocks         |
| final writeback       | merge commit is an ancestor of develop                      | issue closure/writeback              | exact writeback retry; never fabricate closure |

Independent review record: round 1 `REVIEW VERDICT: REVISE` (2026-08-29), findings incorporated here;
round 2 endorsement is required and will be recorded in this Evidence Log before implementation.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: internal fix with no contract change; the remedy is the repository's own precedent
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

If GitHub is unavailable or read-back is inconclusive, stop with a durable failed phase and leave the
Issue priority/marker state unchanged where possible. Never fall back to a separate untracked PR or
claim remote/local atomicity. Security, data-correctness, user-decision, or malformed Issues remain on
the existing guarded route and are not converted by this coordinator.

## Solution

1. Update the Issue→Task, user-request, orchestrator, and backlog-execution owner documents so an
   eligible conversion may continue on the same ordered topic branch after remote marker read-back,
   while keeping separate conversion, PLAN, implementation, and verification commits.
2. Extend `scan-user-execution-plan-order.mjs` and its tests to require a precise conversion-evidence
   line in the planning pair and to refuse implementation when the evidence is missing, unreadable,
   mismatched, or retrospective.
3. Preserve the existing triage/gate/PR/review/CI/merge-verification owners; do not create a second
   command, receipt schema, or merge authority.
4. Measure the representative issue #2082 baseline against one same-branch PR lifecycle: PR lifecycle count
   drops from 2 to 1 for the eligible path, and PR-open remote wait is removed from the conversion
   phase; do not claim that this child proves queue-wide throughput improvement.

## Affected Files

See Architecture Review § Affected Scope; no package runtime surface or dependency direction changes.

## Completion Criteria

Test fixture contract: `conversion-evidence.test.mjs` constructs task/spec text in memory. Its named
tests are `rejects missing evidence`, `accepts eligible P0`, `accepts eligible P1`, `refuses each
eligibility field`, `refuses duplicate evidence`, `refuses malformed evidence`, `refuses subject
mismatch`, and `refuses unreachable base`. The two
success fixtures use `priority=P0` and `priority=P1`; refusal fixtures use one changed field at a time
for `work-kind=bug`, `priority=P2`, `issue-state=CLOSED`, `child-causes=1`, each of
`security/data-correctness/user-decision/contract-change=present`, `owner-count=2`, duplicate or
malformed Conversion evidence, and a base OID that is not an ancestor. Each refusal returns
`{ kind: 'refused', reason: '<stable-code>' }`; missing evidence returns
`reason: 'conversion-evidence-missing'`, duplicate returns `conversion-evidence-duplicate`, and a
cross-subject marker returns `conversion-evidence-subject-mismatch`. The checkpoint fixtures named
`rejects retrospective checkpoint` and `rejects implementation before checkpoint` in
`scan-user-execution-plan-order.test.mjs` add a retrospective checkpoint and an implementation commit
whose parent is not the checkpoint; both must exit 1 with the scanner's existing fail-closed error.

Triage failure contract: `github-issue-triage.test.mjs` exercises the existing
`finalizeIssueConversion({ getIssue, postComment, removeLabels })` function boundary with marker write
succeeding and marker read-back throwing. The expected outcome is the existing thrown error matching
`Task marker .* was not readable after write-back`; `removeLabels` is not called and the existing test
counter `removeCalled` remains false. No duplicate Task API exists at this boundary, so duplicate-task
prevention is covered by the exact-marker idempotency fixture rather than an invented counter. This
test does not make a live GitHub mutation. TC-05's live command is read-only.

Measurement contract: each measurement JSON contains `{ schema: 1, capturedAt, repository,
sourcePrs: [{ number, title, state, openedAt, mergedAt, mergeCommit, labels }], prLifecycleCount,
conversionPrCount, conversionPrOpenWaitSeconds }`. A conversion PR is identified by the exact
`docs(security-002): convert issue 2082 to decoder task` title; labels are recorded as corroborating
metadata but are not required because the verified baseline PR has no labels. Timestamps are ISO UTC and wait
seconds are the sum of `mergedAt - openedAt` intervals for conversion PRs. Candidate selection runs
`gh pr list --repo woojubb/robota --head "$(git branch --show-current)" --state merged --json number`
and first asserts exactly one result with `jq -e 'length == 1'`, then passes that number to the
measurement command; the command refuses a non-merged or missing PR and creates the requested output
directory. Measurement tools are read-only except for their explicitly requested output file.

- [ ] TC-01: after implementation, `pnpm exec vitest run scripts/harness/__tests__/conversion-evidence.test.mjs -t "rejects missing evidence"` exits 0; RED proof uses `git worktree add --detach /tmp/proc-017-red origin/develop`, `mkdir -p /tmp/proc-017-red/scripts/harness/__tests__`, `cp scripts/harness/__tests__/conversion-evidence.test.mjs /tmp/proc-017-red/scripts/harness/__tests__/`, runs the same command there and observes exit 1 because `conversion-evidence.mjs` is absent, verifies the non-zero status, then runs `git worktree remove --force /tmp/proc-017-red` and verifies `test ! -e /tmp/proc-017-red`.
- [ ] TC-02: `pnpm exec vitest run scripts/harness/__tests__/proc-017-affected-paths.test.mjs -t "classifies PROC-017 affected paths"` exits 0 with a pure changed-path fixture whose exact expected set is `scripts/harness/conversion-evidence.mjs`, `scripts/harness/__tests__/conversion-evidence.test.mjs`, `scripts/harness/scan-user-execution-plan-order.mjs`, `scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs`, `scripts/harness/__tests__/proc-017-affected-paths.test.mjs`, `scripts/harness/record-pr-lifecycle-measurement.mjs`, `scripts/harness/compare-pr-lifecycle-measurements.mjs`, `scripts/harness/__tests__/pr-lifecycle-measurement.test.mjs`, `scripts/harness/__tests__/record-pr-lifecycle-measurement.test.mjs`, `scripts/harness/__tests__/compare-pr-lifecycle-measurements.test.mjs`, `.agents/rules/backlog-execution.md`, `.agents/skills/issue-to-backlog/SKILL.md`, `.agents/skills/backlog-execution-orchestrator/SKILL.md`, and `.agents/skills/user-request-gate/SKILL.md`; then `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` exits 0 on the clean committed change.
- [ ] TC-03: `pnpm exec vitest run scripts/harness/__tests__/conversion-evidence.test.mjs scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs -t "accepts eligible|refuses|checkpoint"` exits 0 and covers the named zero/multiple/malformed/mismatched evidence, eligibility refusal, retrospective checkpoint, and implementation-before-checkpoint tests. `git diff --exit-code origin/develop...HEAD -- .github/workflows/review-gate.yml scripts/harness/check-review-gate.mjs .agents/skills/post-merge-cycle/SKILL.md` exits 0, proving downstream guardians remain unchanged.
- [ ] TC-04: `pnpm harness:scan --affected` exits 0; each exact command below returns a match: `rg -n "same ordered topic branch|fail-closed" .agents/rules/backlog-execution.md`, `rg -n "Conversion evidence|Combined lifecycle eligibility" .agents/skills/issue-to-backlog/SKILL.md`, `rg -n "same ordered topic branch|fail-closed" .agents/skills/backlog-execution-orchestrator/SKILL.md`, `rg -n "Conversion evidence|P0|P1" .agents/skills/user-request-gate/SKILL.md`, `rg -n "parseConversionEvidence|checkpoint" scripts/harness/scan-user-execution-plan-order.mjs`, and `rg -n "refused|malformed|P0|P1" scripts/harness/__tests__/conversion-evidence.test.mjs`.
- [ ] TC-05: `pnpm exec vitest run scripts/harness/__tests__/conversion-evidence.test.mjs -t "marker evidence is pure"` exits 0 and proves the parser has no GitHub mutation dependency; `pnpm exec vitest run scripts/harness/__tests__/github-issue-triage.test.mjs -t "does not remove priority when Task-marker write-back fails"` exercises `finalizeIssueConversion({ getIssue, postComment, removeLabels })`, expects the existing unreadable-marker error, and asserts `removeCalled=false`; `gh issue view 2514 --repo woojubb/robota --json labels,comments | jq -e '([.labels[].name] | index("priority:P0")) == null and ([.comments[].body] | any(test("robota-task: PROC-017")))'` verifies the live marker/priority state read-only.
- [ ] TC-06: `node scripts/harness/record-pr-lifecycle-measurement.mjs --source-prs 2501,2507 --output .agents/evidence/PROC-017-baseline.json` records the two verified merged PRs (`2501` conversion and `2507` implementation, merge identities/timestamps included); after this candidate PR merges and before its branch is deleted, `CANDIDATE_PR=$(gh pr list --repo woojubb/robota --head "$(git branch --show-current)" --state merged --json number | jq -e 'length == 1 and .[0].number' )` followed by `node scripts/harness/record-pr-lifecycle-measurement.mjs --source-prs "$CANDIDATE_PR" --output .agents/evidence/PROC-017-candidate.json` records one merged PR and zero conversion PRs; `node scripts/harness/compare-pr-lifecycle-measurements.mjs .agents/evidence/PROC-017-baseline.json .agents/evidence/PROC-017-candidate.json` exits 0 only for baseline `pr_lifecycle_count=2`, candidate `=1`, candidate `conversion_pr_count=0`, and candidate `conversion_pr_open_wait_seconds=0`; after the evidence commit, `git ls-files --error-unmatch .agents/evidence/PROC-017-baseline.json .agents/evidence/PROC-017-candidate.json` exits 0.

## Test Plan

| TC-ID | Test Type          | Tool / Approach                                                                                                                                                                             | Notes                                                                       |
| ----- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| TC-01 | Unit/integration   | `pnpm exec vitest run scripts/harness/__tests__/conversion-evidence.test.mjs -t "rejects missing evidence"`                                                                                 | RED on merge-base, GREEN after parser/guard                                 |
| TC-02 | Suite              | `run-all-scans-affected.test.mjs` pure classification fixture, then `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` on the clean commit | exact affected harness and owner set                                        |
| TC-03 | Unit + owner gates | `conversion-evidence.test.mjs` and `scan-user-execution-plan-order.test.mjs` focused fixtures; existing review gate, CI, merge-verifier, and Issue writeback                                | explicit conversion/checkpoint fixtures; downstream owners remain unchanged |
| TC-04 | Governance         | `pnpm harness:scan --affected` plus one exact `rg` command per owner file                                                                                                                   | every owner surface wired                                                   |
| TC-05 | Integration        | pure conversion parser test plus existing `github-issue-triage.test.mjs` adapter failure fixture and read-only issue #2514 read-back                                                        | marker precedes label removal                                               |
| TC-06 | Measurement        | `record-pr-lifecycle-measurement.mjs` plus `compare-pr-lifecycle-measurements.mjs` over committed `.agents/evidence/PROC-017-*.json` artifacts; baseline is merged PRs #2501 and #2507      | 2→1 lifecycle; conversion wait target 0                                     |

## User Execution Test Scenarios

**Not applicable.** `PROC-017` changes repository-internal issue triage, planning gates, branch ancestry,
and harness enforcement only. It changes no `robota` runtime command, TUI/browser flow, public SDK/example,
configuration contract, or product output. The exact governance procedure and its engineering evidence
are covered in `## Test Plan`; inventing a product scenario for an internal harness command would violate
the user-execution rule.

`SCENARIO DRAFTED: not-applicable | 0` — author verdict, 2026-08-29.

## Tasks

- [ ] `.agents/tasks/PROC-017-combine-issue-conversion-approved-plan-and-implementation-into-one-ordered-pr-li.md` — todo

## Evidence Log

- 2026-08-29 — `DEPTH: SYSTEMIC` from independent finding-depth-triager.
- 2026-08-29 — round 1 `REVIEW VERDICT: REVISE` from independent proposal-reviewer; findings are
  incorporated in the ordering, eligibility, ownership, idempotency, and verification sections.
- 2026-08-29 — prior-art research completed; existing primitives and gaps recorded above.
- 2026-08-29 — revised independent proposal review: `REVIEW VERDICT: REVISE`; command-based product
  surface was removed because it was not a canonical Robota product surface, and the scope was bound
  to existing triage/gate/plan-order owners.
- 2026-08-29 — revised scenario author verdict: `SCENARIO DRAFTED: not-applicable | 0`; this is
  repository-internal workflow/harness policy with no runnable product surface.
- 2026-08-29 — latest independent proposal review: `REVIEW VERDICT: REVISE`; implementation paths,
  runnable refusal fixtures, and durable lifecycle measurement were made explicit in Completion Criteria.
- 2026-08-29 — latest independent gate guard: `GATE-WRITE: FAIL`; implementation remains forbidden
  until the parser/guard, refusal fixtures, and measurement artifacts are independently accepted.
- 2026-08-29 — GitHub read-back verified the representative baseline: PR #2501 is the merged conversion
  PR and PR #2507 is the merged implementation PR; PR #2506 is closed without merge and is excluded from
  lifecycle measurement.
- 2026-08-29 — baseline merge identity recorded: PR #2501 merged as
  `5889201b069d339190ce35e749985934dce90866` at `2026-08-29T08:31:35Z` after opening at
  `2026-08-29T08:20:01Z`; PR #2507 merged as `f14b164ba7ef402458f0cf08c69ff920dce9966c` at
  `2026-08-29T11:17:05Z` after opening at `2026-08-29T09:59:49Z`.
- 2026-08-29 — latest audit findings incorporated: affected-path verification is a deterministic
  fixture, triage failure testing names the existing function/error/counter, measurement schema now
  includes `openedAt` and exact candidate cardinality, and no unsupported duplicate-task counter is
  claimed.
- 2026-08-29 — independent proposal reviewer: `REVIEW VERDICT: ENDORSE`; all prior review findings
  are resolved, including the 11-path affected set and executable evidence procedures.

### [GATE-WRITE] — ❌ FAIL | 2026-08-29

**Status remains:** draft
**Failed criteria:**

- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec : "## Prior Art Research" present but not substantiated — needs ≥1 documentation citation (http link) or an explicit "no comparable reference found", or a "Waived: <reason>" line.
  **Required action:** cite a documentation source, state that none was found, or add `Waived: <reason>`
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present (opt-out the agent proposed or the user requested) — a bare : "## Prior Art Research" present but not substantiated — needs ≥1 documentation citation (http link) or an explicit "no comparable reference found", or a "Waived: <reason>" line.
  **Required action:** cite a documentation source, state that none was found, or add `Waived: <reason>`

### [GATE-WRITE] — ✅ PASS | 2026-08-29

**Status upgrade:** `draft` → `review-ready`

**Independent guardian verdict:** `GATE-WRITE: PASS` — the Problem, Prior Art, Architecture Review,
Decision, eligibility/refusal contract, exact fixture commands, deterministic affected-path set,
measurement schema, and failure/recovery evidence are sufficiently executable for the planning gate.
Future implementation files are intentionally deliverables of this approved plan, not missing plan
content. User execution scenario is validly `SCENARIO DRAFTED: not-applicable | 0` because this is
repository-internal workflow/harness work.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-29

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "잠재적으로 모두 사전 승인함"
**Given:** 2026-08-29, this conversation
**Review fingerprint:** c7ddcd1d22d5 (review d4d112b6, type/tags 6a90c223)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-08-29, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (c7ddcd1d22d5) equals the document's current fingerprint

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-08-29

**Status remains:** review-ready
**Failed criteria:**

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: status is `review-ready`, `approved` expected
  **Required action:** run the prior gate to PASS first
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names 0/6 TC ids and carries 5 checkbox task(s)
  **Required action:** one task per TC-N
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` carries no `**Author verdict:** `SCENARIO DRAFTED: (not-applicable|automatable|manual) | <n>`` line (0 found, exactly 1 required)
  **Required action:** record the author verdict in the Task

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-08-29

**Status remains:** review-ready
**Failed criteria:**

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: status is `review-ready`, `approved` expected
  **Required action:** run the prior gate to PASS first

### [GATE-APPROVAL] — ✅ PASS | 2026-08-29

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "잠재적으로 모두 사전 승인함"
**Given:** 2026-08-29, this conversation
**Review fingerprint:** c7ddcd1d22d5 (review d4d112b6, type/tags 6a90c223)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-08-29, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (c7ddcd1d22d5) equals the document's current fingerprint

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-29

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-08-29; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/PROC-017-combine-issue-conversion-approved-plan-and-implementation-into-one-ordered-pr-li.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/PROC-017-combine-issue-conversion-approved-plan-and-implementation-into-one-ordered-pr-li.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (6)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 634 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "gateImplementFirst",
  "taskPath": ".agents/tasks/PROC-017-combine-issue-conversion-approved-plan-and-implementation-into-one-ordered-pr-li.md",
  "specPath": ".agents/spec-docs/todo/PROC-017-combine-issue-conversion-approved-plan-and-implementation-into-one-ordered-pr-li.md",
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
    },
    {
      "kind": "tc-id",
      "value": "TC-06"
    }
  ],
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/spec-docs/todo/PROC-017-combine-issue-conversion-approved-plan-and-implementation-into-one-ordered-pr-li.md",
    ".agents/tasks/PROC-017-combine-issue-conversion-approved-plan-and-implementation-into-one-ordered-pr-li.md"
  ]
}
```

<!-- checkpoint-evidence:v1:end -->

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-30

**Status upgrade:** in-progress → in-progress (continuation)

- GATE-IMPLEMENT — the approved PROC-017 plan continues after the six sequenced implementation
  artifacts landed through the verified integration commit bound below.
- GATE-IMPLEMENT — the exact paired Task remains `SCENARIO DRAFTED: not-applicable | 0` and the
  checkpoint inventory contains only this active spec and its paired Task.

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "gateImplementContinuation",
  "priorPass": "sha256:baa12856b52227d6526be3bfa0d4624c4c13e3f8bd74c9c67b3de5af96b861f0",
  "sequencedArtifacts": [
    ".agents/evidence/PROC-017-candidate.json",
    ".agents/loop-runs/pr-finding-resolution-loop.jsonl",
    ".agents/skills/backlog-execution-orchestrator/SKILL.md",
    ".agents/skills/user-request-gate/SKILL.md",
    "scripts/harness/__tests__/conversion-evidence.test.mjs",
    "scripts/harness/__tests__/scan-user-execution-plan-order.test.mjs"
  ],
  "ancestorSha": "026d7ac799706d9cd0c2d71b951304bdf8810727",
  "taskPath": ".agents/tasks/PROC-017-combine-issue-conversion-approved-plan-and-implementation-into-one-ordered-pr-li.md",
  "specPath": ".agents/spec-docs/active/PROC-017-combine-issue-conversion-approved-plan-and-implementation-into-one-ordered-pr-li.md",
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/spec-docs/active/PROC-017-combine-issue-conversion-approved-plan-and-implementation-into-one-ordered-pr-li.md",
    ".agents/tasks/PROC-017-combine-issue-conversion-approved-plan-and-implementation-into-one-ordered-pr-li.md"
  ]
}
```

<!-- checkpoint-evidence:v1:end -->
