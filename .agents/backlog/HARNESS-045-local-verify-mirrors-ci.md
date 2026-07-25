---
title: 'HARNESS-045: a single local verification entry that reproduces the CI scans/quality gate exactly'
status: todo
created: 2026-07-25
priority: high
urgency: soon
area: scripts/harness, package.json, .agents/skills, .agents/rules
depends_on: []
---

# HARNESS-045: local verification must mirror what CI asserts

## The class

An agent's FOREGROUND verification — typically `node scripts/harness/run-all-scans.mjs` reported as
"green locally" — does NOT reproduce what the CI `scans` / `quality` jobs assert. So "green locally"
is not the same claim as "green in CI," and an agent can honestly report a passing local run while the
PR fails CI. This is a recurring **agent/technical failure class** (the same kind of "green
locally → red in CI" failure fixed more than once), which is exactly the blind spot the
[lesson-to-harness](../skills/lesson-to-harness/SKILL.md) recurring-failure mining scope now targets.
The terminal state for a recurring mistake is a mechanical prevention, not another one-off fix.

## Evidence (cited instances of the class)

- **Spec-surface baseline false-pass.** The spec-surface scan treats a below-baseline count as a
  pass locally ("below-baseline → tighten"), so a real improvement reads as green in a foreground
  run. But the CI self-test asserts `notices == []`, so the same state fails in CI. Observed on
  #1346 and #1357.
- **Prettier-wrapped multi-line arrays.** Prettier (the repo's SSOT formatter, run via lint-staged)
  wraps a long YAML `tags` array onto multiple lines, but `check-spec-doc-frontmatter` only parses the
  single-line form, so it reports "tags missing." A `--no-verify` push from a fresh worktree skips
  prettier entirely, so the drift is never produced — and never caught — locally. Observed on
  #1369 → tracked as **HARNESS-044** (the frontmatter-parser sub-fix; a member of this class).

## Root cause

1. The local run treats **baseline notices** (below-baseline spec-surface) and **unbuilt `dist`** as
   a pass, whereas CI self-tests assert `notices == []` and run scans against the built `dist`.
2. **Fresh worktrees lack the husky / prettier toolchain**, so a `--no-verify` push bypasses
   formatting; formatter-induced drift (e.g. multi-line arrays) is never generated locally and thus
   never exercised by the local scans.

Net: the foreground gate and the CI gate assert different things, so a green local run gives false
assurance.

## Prevention to build (the mechanism)

A single `pnpm` verification entry — e.g. `pnpm harness:verify-like-ci` — that reproduces the CI gate
exactly, so an agent's self-verification catches these BEFORE push:

1. Runs the harness **self-test suite** (so the spec-surface baseline assertion `notices == []`
   trips locally instead of silently passing below-baseline).
2. Runs a **prettier `--check`** over the changed files (so formatter-induced drift — multi-line
   arrays, wrapping — is surfaced even on a fresh worktree that would otherwise `--no-verify`).
3. Runs the scans against the **built `dist`** (so unbuilt-`dist` no longer masks a failure).

Then wire a reference to this single entry into:

- the parallel-orchestration skill's verification step (agents self-verify with the CI-equivalent
  command, not bare `run-all-scans`); and
- the `git-branch.md` pre-merge guidance (the pre-push / pre-merge check is the CI-equivalent entry).

## Why this is deferred (concrete obstacle, per lesson-to-harness step 8 "infeasible-now")

The mechanism lives in `scripts/harness/**`, which is currently **contended by another active agent**
(ARCH-005 S1 is editing `scripts/harness`). Building the new entry now would conflict. Coordinate:
**build this AFTER ARCH-005 S1 merges** to avoid stepping on its in-flight changes. This is a
scheduling obstacle, not a design blocker — hence a tracked backlog item rather than silence, which
is the sanctioned "infeasible-now + tracked backlog" terminal state.

## Red-first plan (per lesson-to-harness step 9)

1. Reproduce a **below-baseline spec-surface improvement** and a **prettier-wrapped multi-line array**
   in a fixture.
2. Show `node scripts/harness/run-all-scans.mjs` reports GREEN on both while the new
   `harness:verify-like-ci` entry FAILS (it asserts `notices == []`, runs prettier `--check`, and
   scans the built `dist`).
3. After the fix / formatting, show the new entry PASSES. Record the before/after result.

## Test Plan

- Fixture-based red/green pair for each cited instance (below-baseline spec-surface; prettier-wrapped
  tags), demonstrating the new entry FAILS where `run-all-scans` passed, then PASSES after fix.
- Register the new entry so CI and the local run assert the same thing; `pnpm harness:test` +
  `run-all-scans` green.

## User Execution Test Scenarios

- Not applicable (harness / CI-parity check; governance-only change with no runnable user-facing
  behavior). Evidence: the fixture red/green pairs above, run by the agent.

## Related

- **HARNESS-044** — frontmatter scan must parse prettier-wrapped multi-line arrays; a member of this
  class (the formatter-drift-not-caught-locally instance).
- **HARNESS-041** — mechanical accidental-green floor; sibling "the local check must actually assert
  what it claims" floor.
