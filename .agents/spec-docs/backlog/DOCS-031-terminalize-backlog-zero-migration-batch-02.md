---
status: review-ready
type: INFRA
tags: [docs, migration]
lane: L2
---

# DOCS-031: Terminalize backlog-zero migration batch 02

## Problem

At fixed population object `2c875dd3ec6938d6eb0563b50c40d1f116fb4e7e`, three more legacy
units remain nonterminal on the integration branch. ARCH-110 already has an exact open GitHub owner,
ARCH-111 was delivered by a merged PR but never terminalized, and CLI-032 was historically marked
done even though no product implementation landed and therefore needs a corrected continuation owner.

The current `origin/develop` base is `d15c9ee8dc1836c38eb08922826b81cda1568da3`. All six governed
source blobs are byte-identical between the fixed population and this base. The open PR set is empty,
the current batch branch is the only worktree/branch owner, and no assignee or loop reservation owns
implementation of these units. Leaving the records open preserves a second durable queue and makes
partial containment or an invalid historical completion look like current ownership.

## Prior Art Research

Waived: RULE-017 and the registered `BACKLOG-ZERO-MIGRATION` class already selected the finite
manifest, exact readback, append-only handoff, and history-preserving terminalization mechanism. This
batch applies that mechanism to fixed repository records and makes no product or policy decision.

## Architecture Review

### Affected Scope

- Three Task lifecycle paths for ARCH-110, ARCH-111, and CLI-032.
- The paired ARCH-111 draft spec, whose implementation delivered but whose gate chain did not.
- One CLI-083 relative-link carrier that must distinguish the archived ARCH-110 record from open
  implementation issue #2295.
- The paired DOCS-031 Task/spec and the two required loop ledgers.
- Append-only GitHub issue creation/comments only.

No package/app source, public API/contract, policy/gate rule, skill/workflow/hook, baseline JSON,
workspace topology, product direction, or user-authored documentation is in scope.

### Alternatives Considered

1. Leave all three records open. Pro: no lifecycle edits. Con: keeps the integration branch as a second
   durable queue and hides the exact remote owner or delivered state.
2. Delete or bulk-mark the records done. Pro: smallest queue count. Con: destroys history and falsely
   treats partial containment, an invalid done spec, and unfinished criteria as delivery.
3. Revalidate each unit, append exact current-state handoffs for unfinished work, independently prove
   delivered work, and terminalize without rewriting historical gates. Pro: one canonical remote
   queue with preserved evidence. Con: requires exact remote readback and one carrier correction.

### Decision

Choose alternative 3. ARCH-110 and CLI-032 become skipped Tasks returned to exact issue comments.
ARCH-111 becomes a done Task because PR #2357 delivered every criterion, while its draft spec becomes
rejected because no valid GATE-WRITE through GATE-COMPLETE chain exists. The historical CLI-032 done
spec remains byte-unchanged and is explicitly not implementation evidence.
This accepts the cost of exact remote readback and a narrow carrier correction in exchange for one
canonical remote queue and preserved history, avoiding both destructive deletion and false bulk
completion.

ARCH-047, ARCH-048, and ARCH-049 are deliberately excluded. Terminalizing them would require edits to
four package SPEC/README carrier files, producing at least sixteen changed paths and crossing both the
fifteen-path ceiling and the delegated class's package-document boundary. Their Tasks and exact open
issues #2151, #2152, and #2153 remain unchanged for a separately authorized carrier-safe batch.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — lifecycle documents, one relative-link carrier, and ledgers only
- [x] Sibling scan 완료 — all three units, source blobs, issues, PRs, branches, worktrees, reservations,
      baselines, partial delivery, and current implementation evidence checked
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None

## Migration Manifest

Population object: `2c875dd3ec6938d6eb0563b50c40d1f116fb4e7e`.

Pre-approval base: `origin/develop` at `d15c9ee8dc1836c38eb08922826b81cda1568da3`.

Limits: 3 units; 9 final tracked paths. The `/tmp` survey is discovery-only. Every governed source
blob below is identical at the population object, base, and this branch. There are zero baseline
rekeys and zero baseline additions.

| Unit     | Original path(s) and blob OID(s)                                                                                                                                                                                                                                                                                               | Current ownership and evidence                                                                                                                                                                                                                                                                                           | Criterion-level disposition                                                                                                                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ARCH-110 | `.agents/tasks/ARCH-110-session-capability-projections-can-silently-drop-optional-fields.md` @ `05c74b1cebaaa2cae46b9fd0d7ee5d50ce969f66`                                                                                                                                                                                      | Exact OPEN/unassigned issue #2295. PR #2293 merge `d39c9e12979d46e9efe40e8ba823f0503c296c78` delivered loader, command-module, serve, and TUI-shell containment, but final TUI/headless projections and relation guard remain. Canonical handoff: https://github.com/woojubb/robota/issues/2295#issuecomment-5455186636. | Relation-level projection ownership, mutation proof, final TUI and print/goal `orgPolicy` hops, and real disk-loaded blocked-command scenarios remain. Task `skipped`, returned to the cited comment; update only CLI-083's relative carrier link. |
| ARCH-111 | `.agents/tasks/ARCH-111-the-executor-re-exports-core-owned-provider-helpers-so-two-consumers-disagree-ab.md` @ `4bca928bc7e275b80c451d7372f9fb148a178346`; `.agents/spec-docs/draft/ARCH-111-the-executor-re-exports-core-owned-provider-helpers-so-two-consumers-disagree-ab.md` @ `67d41d355a9d36e31240a77eb68c9bff5c5580e1` | PR #2357 merge `69496794df7324d1110de89dcb5a39074a0026be` is a base ancestor. The executor exports are absent, framework imports the core owner, positive/type controls and SPEC agree, current tests/typecheck/scans pass. #2051/#2347 own a separate ambient-resolver half and remain open.                            | All declared criteria delivered. Task `done`, `completed: 2026-08-26`. Spec `rejected` because it remained draft without a valid complete gate chain; preserve its evidence and add only a terminal note.                                          |
| CLI-032  | `.agents/tasks/CLI-032-git-first-class-commands.md` @ `f0d9836c693f9e35a89931528aa3448075ee8814`; preserved `.agents/spec-docs/done/CLI-032-git-first-class-commands.md` @ `2a388db899665b6fcfaed0233b99109a81d0a3df`                                                                                                          | Unique exact OPEN/unassigned issue #2437 with marker `backlog-zero:CLI-032:2c875dd3`; canonical handoff: https://github.com/woojubb/robota/issues/2437#issuecomment-5455186642. PR #589 changed no product source; current source has no `/status`, `/diff`, or `/commit` module.                                        | Product/ownership decision remains; if retained, status/diff/confirmed commit behavior, parsing/permissions/tests, and a shipped CLI scenario remain. Task `skipped`, returned to the cited comment. Preserve the historical done spec unchanged.  |

Carrier source: `.agents/tasks/CLI-083-the-org-policy-loader-has-no-caller-so-four-enforcement-sites-are-unreachable-in.md`
@ `31ab50304004a5d5a47cf413f4e0a722dc7277f3`, identical at population/base/branch. Its current
relative ARCH-110 Task link must move to the completed record and label that record as archived while
retaining #2295 as the open implementation owner.

Live ownership check: no open PR; no matching implementation branch, extra worktree, assignee,
session, or loop reservation. This branch is the sole migration owner and owns no implementation.
Any source-blob or ownership change excludes that unit and requires a fresh manifest approval.

Control issue #2436 is OPEN/unassigned and uniquely carries marker
`backlog-zero:DOCS-031:2c875dd3`; it owns this batch PR only. Parent #2404 remains open for later
batches and the preventive durable-queue mechanism.

### Baseline disposition

The only related frozen keys are `done/CLI-032-git-first-class-commands.md` in the standing-delegation
and spec-user-execution baselines. The referenced historical done spec is preserved at that exact path,
so both keys remain unchanged. No governed source path appears in the reference-kind baseline.

## Solution

1. Commit this exact manifest, create/read back the CLI-032 continuation issue and the DOCS-031 control
   issue, then append/read back the two canonical unfinished-work handoff comments.
2. Record class approval only after exact issue/comment URLs and unchanged source ownership are proven.
3. Create the paired DOCS-031 planning checkpoint, then add `returned_to_issue` and terminalize the two
   unfinished Tasks as skipped without deleting history.
4. Terminalize ARCH-111 independently as Task done/spec rejected, preserving all historical evidence.
5. Correct CLI-083's carrier link, leave the CLI-032 done spec and every baseline byte-unchanged, and
   run the declared verification before completing DOCS-031.

## Affected Files

- `.agents/loop-runs/backlog-execution-orchestrator.jsonl`
- `.agents/loop-runs/user-execution-scenario.jsonl`
- `.agents/spec-docs/done/DOCS-031-terminalize-backlog-zero-migration-batch-02.md`
- `.agents/tasks/completed/DOCS-031-terminalize-backlog-zero-migration-batch-02.md`
- `.agents/tasks/completed/ARCH-110-session-capability-projections-can-silently-drop-optional-fields.md`
- `.agents/tasks/completed/ARCH-111-the-executor-re-exports-core-owned-provider-helpers-so-two-consumers-disagree-ab.md`
- `.agents/spec-docs/rejected/ARCH-111-the-executor-re-exports-core-owned-provider-helpers-so-two-consumers-disagree-ab.md`
- `.agents/tasks/completed/CLI-032-git-first-class-commands.md`
- `.agents/tasks/CLI-083-the-org-policy-loader-has-no-caller-so-four-enforcement-sites-are-unreachable-in.md`

## Completion Criteria

- [ ] TC-01: the committed manifest contains exactly three units, nine final tracked paths, all six
      source/carrier blob OIDs, current ownership, one disposition per unit, and zero baseline changes.
- [ ] TC-02: one unique CLI-032 continuation issue, two canonical handoff comments, and the DOCS-031
      control issue are read back; every skipped Task cites its exact canonical comment URL.
- [ ] TC-03: ARCH-110 and CLI-032 become skipped, ARCH-111 becomes done, and its draft spec
      becomes rejected; no record is deleted or historical verdict rewritten.
- [ ] TC-04: CLI-083 distinguishes the archived ARCH-110 record from open issue #2295; the CLI-032 done
      spec and all baseline files are byte-unchanged.
- [ ] TC-05: focused lifecycle/path/reference/delegation checks, `pnpm harness:scan`, and
      `pnpm harness:verify-like-ci` exit 0 on the final branch.

## Test Plan

| TC-ID | Test Type                | Tool / Approach                                                  | Notes                                                                 |
| ----- | ------------------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------- |
| TC-01 | Agreement / manifest     | Git object/blob comparison, exact path set, unit/path count      | Prove immutable population and ceiling.                               |
| TC-02 | Agreement / remote       | Exact title/marker search and `gh api` issue/comment readback    | Prove one canonical remote owner per skipped Task.                    |
| TC-03 | Agreement / lifecycle    | Task archival and spec folder/status scanners                    | Prove terminal placement without deletion.                            |
| TC-04 | Agreement / preservation | Git blob comparison, task-path citation and baseline diff checks | Prove carrier truth and zero mutation of protected history/baselines. |
| TC-05 | Agreement / CI           | Focused scanners, full harness scan, CI mirror                   | Prove final repository gates.                                         |

## Tasks

- [ ] `.agents/tasks/DOCS-031-terminalize-backlog-zero-migration-batch-02.md`

## User Execution Test Scenarios

Not applicable. This batch changes internal lifecycle evidence, one relative documentation link, and
remote queue ownership only. It adds no runnable user-facing behavior.

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-29

**Status upgrade:** draft → review-ready

- GATE-WRITE — Mechanical criteria: 20/20 PASS; frontmatter, research waiver, architecture checklist,
  alternatives, five observable criteria, matching Test Plan, Tasks placeholder, and empty initial
  Evidence Log all satisfy the L2 document contract.
- GATE-WRITE — Concrete symptom: three fixed nonterminal records preserve a duplicate durable queue;
  one has an exact owner, one delivered without lifecycle closure, and one has invalid historical done
  evidence but no implementation or continuation owner.
- GATE-WRITE — Reproduction: fixed population/base OIDs, six identical blobs, empty open-PR set, and
  absence of a competing branch/worktree/assignee/reservation pin the condition.
- GATE-WRITE — Research feeds Decision: the approved RULE-017/BACKLOG-ZERO mechanism selects exact
  manifest, readback, handoff, and history-preserving terminalization without making product policy.
- GATE-WRITE — Decision trade-off: exact remote readback and one carrier correction are accepted for
  canonical queue ownership and preserved history, while deletion and false completion are rejected.
- GATE-WRITE — New-surface placement: N/A; no package/app/API/policy/workflow/product surface changes.
- GATE-WRITE — Criterion coverage and observability: TC-01 through TC-05 independently measure the
  manifest, remote ownership, lifecycle, carrier/history preservation, and final verification.
- Guardian re-review: all 7 semantic criteria PASS; `ACTIONABLE FINDINGS: 0`.
- Proposal review after scope correction: `REVIEW VERDICT: ENDORSE`; `DEPTH: 0 FOUNDATIONAL of 0`;
  `ACTIONABLE FINDINGS: 0`.
- Independent manifest audit: exactly 3 units, 9 final paths, 6 unchanged blobs, zero baseline changes,
  and no missing live carrier; `ACTIONABLE FINDINGS: 0`.
- Scope correction preserved: ARCH-047/048/049 and their four package-document carriers remain
  byte-unchanged with issues #2151/#2152/#2153 open; including them would require 16 paths and leave
  the delegated class.

### [REMOTE-GROUNDING] — ✅ PASS | 2026-08-29

- Frozen manifest commit: `0f9c021f1`.
- Control issue #2436 and CLI-032 continuation issue #2437 are OPEN, unassigned, and uniquely match
  markers `backlog-zero:DOCS-031:2c875dd3` and `backlog-zero:CLI-032:2c875dd3`.
- Canonical ARCH-110 handoff read back at
  https://github.com/woojubb/robota/issues/2295#issuecomment-5455186636.
- Canonical CLI-032 handoff read back at
  https://github.com/woojubb/robota/issues/2437#issuecomment-5455186642.
- Both comments preserve decision, current evidence, remaining criteria, dependencies/resumption,
  original path/blob provenance, and the fixed population object.
- Parent #2404 remains OPEN. All 6 source/carrier blobs, zero baseline changes, and sole migration
  ownership remain unchanged after remote mutation.
- Independent exact readback: `ACTIONABLE FINDINGS: 0`.
