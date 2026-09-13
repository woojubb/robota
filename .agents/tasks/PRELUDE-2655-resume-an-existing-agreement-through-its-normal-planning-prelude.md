---
title: 'PRELUDE-2655: Resume an existing Agreement through its normal planning prelude'
issue: https://github.com/woojubb/robota/issues/2655
status: todo
created: 2026-09-13
priority: high
urgency: now
area: harness planning validation
depends_on: []
---

# PRELUDE-2655: Resume an existing Agreement through its normal planning prelude

Spec: `.agents/spec-docs/todo/PRELUDE-2655-resume-an-existing-agreement-through-its-normal-planning-prelude.md`

## Objective

Correct the new-Agreement classifier so an existing Agreement's planning-only revision uses the
ordinary planning validator. Preserve that validator's rejection of unrelated source changes,
invalid lifecycle records and mixed planning units; preserve all atomic-new-Agreement checks.

## Plan

- [ ] TC-01: Reproduce existing-parent pair, spec-only and valid spec-move misclassification using in-memory snapshots.
- [ ] TC-02 and TC-03: Restrict the shared atomic-new-parent classifier while preserving generic refusals, genuine new-parent validation and ordinary-Task reclassification refusal.
- [ ] TC-04: Verify equivalent staged/history routing, with and without a later checkpoint, using mocked process responses and the whole dedicated test file.

## Test Plan

Planned command: `pnpm exec vitest run scripts/harness/__tests__/agreement-prelude.test.mjs`.
Use pure before/after maps and the existing `post-merge-symbolic-cache.test.mjs` spawnSync mock
pattern. Observe RED before source edits, then GREEN for the whole dedicated file. Unexpected
process calls must throw rather than fall through to real Git. No tests or gates have run for
this Task. Do not create Git repositories, worktrees or clones, rebind HOME, or execute product
or PTY tests. Main owns gates, checkpoint and final affected verification.

## Completion Criteria

- [ ] TC-01: Existing Agreement pair/spec-only/move planning cases reach and satisfy generic validation.
- [ ] TC-02: Generic source, state, deletion, ledger and mixed-unit refusals remain enforced.
- [ ] TC-03: Genuine new atomic manifests retain validation; ordinary-Task reclassification is not exempted.
- [ ] TC-04: Shared staged/history routes agree under pure/mock regressions, with recorded RED/GREEN evidence.

## Scope

`scripts/harness/scan-user-execution-plan-order.mjs` and
`scripts/harness/__tests__/agreement-prelude.test.mjs` only, plus this planning pair.
No package API, approval policy, checkpoint requirement or archival predicate changes.

Lane: L1. This is one LOCAL routing defect within #2655, not a new Issue or a new parent
implementation. Existing explicit owner authorization in this conversation applies:

> 작업을 저해하거나 잘못된 규칙이나 맞지 않는 규칙이 발견된다면 레포속 규칙을 개선하면서 이슈를 처리해 주세요.

This authoring dispatch changes only the planning pair. It does not supply a guardian judgment,
advance a lifecycle, or reinterpret the parent's actual approvals as historical preimplementation
evidence. Main alone owns Git and gate execution.

## Progress

2026-09-13: read-only allocator dry-run selected PRELUDE-2655 with zero commits behind develop.
The subsequent creation attempt refused because this session had already opened its routing run
with that ID. A repository search found only that same run, no competing Task/spec. This paired
record reconciles the existing self-reference; no alternate ID or external Issue is created.
The approved parent pair and its actual gate records are preserved in the main-owned stash.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This internal classifier selects the validator for repository planning records; it adds
no callable SDK function, conversation behavior, command interface or application view for end users.
