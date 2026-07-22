---
title: 'HARNESS-041: mechanical floor for accidental-green regression tests (prove RED without the fix)'
status: todo
created: 2026-07-21
priority: medium
urgency: soon
area: scripts/harness, .github/workflows
depends_on: []
---

# Mechanical floor — a defect-fix regression test must FAIL without the source fix

## Problem

A regression test for a bug/leak/race fix is worthless if it passes on the buggy code too
("accidental-green") — it guards nothing and is false assurance. The principle is now a rule
([tdd-and-planning.md](../rules/tdd-and-planning.md) "Prove the regression test RED") and a REQUIRED
`pr-review-reviewer` guardian step (it runs the new test against the pre-fix state and flags a SHOULD if it
does not fail). But the guardian is an agent judgement — the enforcement-architecture rule wants every
guardian backed by a mechanical scan/hook floor. This item builds that floor.

Recurred twice in one session (ARCH-004 RUNTIME-14, CORE-026 RUNTIME-12), both caught only by the reviewer
running the test against `origin/develop`.

## What (the mechanical check)

For a PR whose diff touches both `packages/*/src/**` (a fix) and test files, a harness check that:

1. Splits the PR diff into **source** vs **test** changes.
2. Reconstructs the pre-fix tree with ONLY the test changes applied (source at the merge-base) — e.g. a
   throwaway `git worktree` at the base, then apply the test-file patch.
3. Runs the new/changed tests. **At least one must FAIL** (proving the test exercises the fixed behavior).
4. If every new/changed test PASSES without the source fix → FAIL the check ("accidental-green").

## Why this is deferred (concrete obstacle, per lesson-to-harness step 8)

Not a clean always-on scan today: (a) **pairing** — the harness has no attribution of which test guards which
source change, so it must heuristically run _all_ new tests without _all_ source changes, which mis-handles a
PR that legitimately mixes a fix with unrelated new tests; (b) **false positives** — a new test can correctly
pass at the base (it covers pre-existing behavior, a doc/refactor-only test, or a fixture), so the check needs
an opt-out (`allow-green-at-base: <reason>`) and must scope to PRs that self-declare a defect fix; (c) **cost**
— it runs the affected test suite twice per qualifying PR. These are design problems, not blockers — hence a
tracked item rather than silence.

## Test Plan

- Red/green fixtures: a PR-shaped diff whose test is accidental-green (passes at base) → check FAILS; a diff
  whose test is genuinely red-at-base → check PASSES. Register in `run-all-scans` (or a CI job) once stable.

## User Execution Test Scenarios

- Not applicable (harness/CI check; the scan's own red/green fixtures are the maintained gate).
- Evidence: the fixture pair above, run by the agent.
