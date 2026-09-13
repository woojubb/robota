---
title: 'PRELUDE-2655: Resume an existing Agreement through its normal planning prelude'
issue: https://github.com/woojubb/robota/issues/2655
status: done
created: 2026-09-13
priority: high
urgency: now
area: harness planning validation
depends_on: []
completed: 2026-09-13
---

# PRELUDE-2655: Resume an existing Agreement through its normal planning prelude

Spec: `.agents/spec-docs/done/PRELUDE-2655-resume-an-existing-agreement-through-its-normal-planning-prelude.md`

## Objective

Correct the new-Agreement classifier so an existing Agreement's planning-only revision uses the
ordinary planning validator. Preserve that validator's rejection of unrelated source changes,
invalid lifecycle records and mixed planning units; preserve all atomic-new-Agreement checks.

## Plan

- [x] TC-01: Reproduce existing-parent pair, spec-only and valid spec-move misclassification using in-memory snapshots.
- [x] TC-02 and TC-03: Restrict the shared atomic-new-parent classifier while preserving generic refusals, genuine new-parent validation and ordinary-Task reclassification refusal.
- [x] TC-04: Verify equivalent staged/history routing, with and without a later checkpoint, using mocked process responses and the whole dedicated test file.

## Test Plan

Executed by Nash: `pnpm exec vitest run scripts/harness/__tests__/agreement-prelude.test.mjs --no-cache`.
The dedicated file uses pure before/after maps and a hoisted spawnSync mock, following the existing
`post-merge-symbolic-cache.test.mjs` pattern. Unexpected commands throw and are asserted absent;
they never fall through to real Git. The spec Test Plan maps all four criteria to exact test names.
RED/GREEN results are recorded below, not rerun by this content author. No Git repositories,
worktrees, clones, HOME rebinding, product or PTY tests were used. Main owns terminal gates and
final affected verification.

## Completion Criteria

- [x] TC-01: Existing Agreement pair/spec-only/move planning cases reach and satisfy generic validation.
- [x] TC-02: Generic source, state, deletion, ledger and mixed-unit refusals remain enforced.
- [x] TC-03: Genuine new atomic manifests retain validation; ordinary-Task reclassification is not exempted.
- [x] TC-04: Shared staged/history routes agree under pure/mock regressions, with recorded RED/GREEN evidence.

## Result

Nash's recorded implementation verification, relayed on 2026-09-13: the first behavioral
regression failed once against the original new-parent requirements. The final expanded suite
against the original scanner produced 44 FAIL / 48 PASS; with the final repaired scanner restored,
the command above passed 92/92 tests, 0 failures. These are actual worker results, not a new run
or a guardian verdict by this author.

Concrete test owner: `scripts/harness/__tests__/agreement-prelude.test.mjs`, including
`existing Agreement planning prelude`, all three `existing Agreement — %s` reader modes,
`new atomic Agreement — %s`, and `planning order remains enforced`. The implementation is confined
to `agreementPrelude` in `scripts/harness/scan-user-execution-plan-order.mjs`; returning `null`
routes existing Agreements to unchanged generic validation, not automatic acceptance.

Frozen source SHA256: `a081002102f5a87bf41ff762ed873d4da2bf7dc6986c88b4ce8a6278cf14d707`.
Frozen test SHA256: `396c9a65e438b81e3f79ee1742112911b58c7653b2177e6da28bf98b2c4b219b`.
Main confirmed these hashes; this author also read back matching current bytes.

Hume independently reviewed those exact source/test hashes with ACTIONABLE FINDINGS: 0.
Hume subsequently recorded independent L1 DONE PASS, preserving the mechanical FAIL and
requiring post-PASS archival verification. Main performed the supported atomic Task/spec
completion on 2026-09-13. Final-state affected static checks and remote CI remain delivery
obligations; no merge or parent Agreement acceptance is claimed by this Task completion.

## Scope

`scripts/harness/scan-user-execution-plan-order.mjs` and
`scripts/harness/__tests__/agreement-prelude.test.mjs` only, plus this planning pair.
No package API, approval policy, checkpoint requirement or archival predicate changes.

Lane: L1. This is one LOCAL routing defect within issue #2655, not a new Issue or a new parent
implementation. Existing explicit owner authorization in this conversation applies:

> 작업을 저해하거나 잘못된 규칙이나 맞지 않는 규칙이 발견된다면 레포속 규칙을 개선하면서 이슈를 처리해 주세요.

This authoring dispatch changes only the planning pair. It does not supply a guardian judgment,
advance a lifecycle, or reinterpret the parent's actual approvals as historical preimplementation
evidence. Main alone owns Git and gate execution.

## Progress

2026-09-13: L1 PLAN passed (28 PASS, 10 lane-specific N/A) and checkpoint `fdc418d9a`
was committed before implementation. The implementation worker owns only the classifier and
dedicated test file; Main alone owns Git and completion records. Package SPEC updates and
product builds are not applicable because no package or public product contract changes.

2026-09-13: read-only allocator dry-run selected PRELUDE-2655 with zero commits behind develop.
The subsequent creation attempt refused because this session had already opened its routing run
with that ID. A repository search found only that same run, no competing Task/spec. This paired
record reconciles the existing self-reference; no alternate ID or external Issue is created.
The approved parent pair and its actual gate records are preserved in the main-owned stash.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This internal classifier selects the validator for repository planning records; it adds
no callable SDK function, conversation behavior, command interface or application view for end users.
