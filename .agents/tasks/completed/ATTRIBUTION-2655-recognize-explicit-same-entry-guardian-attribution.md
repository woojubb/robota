---
title: 'ATTRIBUTION-2655: Recognize explicit same-entry guardian attribution'
issue: https://github.com/woojubb/robota/issues/2655
status: done
created: 2026-09-13
priority: high
urgency: now
area: scripts/harness
depends_on: []
completed: 2026-09-13
---

# ATTRIBUTION-2655: Recognize explicit same-entry guardian attribution

Spec: `.agents/spec-docs/done/ATTRIBUTION-2655-recognize-explicit-same-entry-guardian-attribution.md`

## Objective

Recognize an actual, visible, unambiguous `Independent guardian: <name>.` declaration in its own
gate entry without rewriting historical evidence. BOUNDARY-2655's original GATE-WRITE and semantic
GATE-APPROVAL entries identify Nash, but the done-only attribution scan recognizes only the
canonical generated field. Inserting that field into old entries conflicts with the completion
guard's preserved Evidence Log prefix. Repair recognition, not archive immutability.

This is one LOCAL compatibility repair supporting the existing Issue #2655 closeout, not a new external
issue or a claim that the umbrella is complete. Hume's independent choice, relayed by the caller
on 2026-09-13, selects scanner recognition over historical normalization. HARNESS-2269 already
requires disclosure of the actual judging mechanism and preservation of historical evidence.

## Authorization and Scope

Owner instruction (verbatim, existing Issue #2655 authority):

> 작업을 저해하거나 잘못된 규칙이나 맞지 않는 규칙이 발견된다면 레포속 규칙을 개선하면서 이슈를 처리해 주세요.

Integrating agent's bounded implementation decision (not a user quote), 2026-09-13:

> Decision confirmed by independent Hume: SELECT simpler attribution-scanner recognition of actual existing explicit guardian.

Lane: L1. The implementation changes one non-comment tooling script and its dedicated tests;
it does not amend an L2 owner rule. No changes to `backlog-execution.md`, the completion predicate,
gate generation, the migration baseline, historical Task/spec entries, or unrelated Issue #2655 scope.
The current dispatch authorizes this planning pair only; main owns subsequent gates/checkpoint.

ID binding uses existing Issue #2655 and the distinct ATTRIBUTION prefix. Read-only allocator
helpers found no Task-record or Issue-title/body collision (1159 record IDs, 455 Issue IDs).
The existing user-request-gate run naming ATTRIBUTION-2655 belongs to this dispatch, not a second
Task. The author used read-only helpers because the allocating CLI also fetches Git refs. Main
later ran its dry-run: the checkout was zero commits behind `origin/develop@f8569d567`; it resolved
existing Issue #2655 and refused duplicate creation because this same pair already claimed the ID.
No duplicate Task or new Issue was created.

## Plan

- [x] TC-01 through TC-03: add focused in-memory RED cases for the two original Nash entries, another named guardian, canonical compatibility, visibility, entry isolation and ambiguous/conflicting declarations.
- [x] TC-01 through TC-04: update the existing scanner using `visibleMarkdown`, preserve original attribution text and canonical generation, and make failure diagnostics name the accepted forms.
- [x] TC-05: add a pure boundary integration case proving an unchanged historical prefix satisfies both completion classification and attribution recognition; verify immutable-history negatives and the dedicated suite without Git fixtures.

## Test Plan

Planned command: `pnpm exec vitest run scripts/harness/__tests__/scan-gate-verdict-attribution.test.mjs`.
Add all new cases to that existing file. Exercise `evidenceEntries` and `evaluateEntries` directly,
and import the existing `isPostMergeCompletionBatch` for an in-memory before/after map integration
case. Capture RED before implementation and GREEN after it. No tests have been executed for this
Task; the plan and Hume's design choice are not gate or implementation results.

Keep the existing counter-reset and baseline cases. Do not run a Git-fixture suite, full CI mirror,
product build, PTY test, or default-home fixture. No worktrees, clones, temporary Git repositories,
HOME rebinding, external writes or local Git mutations are needed.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This changes repository evidence recognition only, with no product-facing runtime or
end-user workflow. Focused parser and completion-boundary tests supply the engineering evidence;
their exit status is not claimed as a product scenario.

## Verification results — 2026-09-13

Command: `pnpm exec vitest run scripts/harness/__tests__/scan-gate-verdict-attribution.test.mjs`.
The paired spec records exact per-criterion verification and the independent DONE judgment.

The original recognition regression failed before implementation: expected the original Nash
declaration, received null (1 failed / 4 passed). Subsequent visibility, ambiguity, diagnostic and
subsection-isolation regressions each failed before their corresponding correction. Final focused
verification at 18:45 KST passed 12/12 tests. It includes both original BOUNDARY entries read from
the repository and the unchanged completion predicate over in-memory documents; seven historical
mutation variants remain rejected. It does not assert real merge ancestry from a synthetic ledger.

The actual done-tree scan examined 2847 gate entries: 385 attributed, 2462 missing historical
baseline entries, zero post-baseline violations, exit 0. An intermediate overly strict canonical
duplicate check rejected four existing combined mechanical/independent records; it was removed to
preserve the established canonical contract. The new manual declaration path alone rejects
duplicate or ambiguous identities. No historical record or baseline was rewritten.

The implementation changed only the scanner and its dedicated tests. No package build, local
Git fixture, HOME rebinding, PTY run, paid model call or product scenario was performed.
