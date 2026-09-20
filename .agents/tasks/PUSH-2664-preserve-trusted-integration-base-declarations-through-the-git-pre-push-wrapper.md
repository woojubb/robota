---
title: 'PUSH-2664: preserve trusted integration-base declarations through the Git pre-push wrapper'
issue: https://github.com/woojubb/robota/issues/2664
status: todo
created: 2026-09-20
priority: high
urgency: now
area: scripts/harness Git pre-push guard bridge
depends_on: [BRANCH-2664]
---

# PUSH-2664: preserve trusted integration-base declarations through the Git pre-push wrapper

## Objective

Preserve the documented statement-bound `HARNESS_BASE_REF` declaration when the Git pre-push hook
bridges into the existing shell guard, so a valid stacked child can be published without weakening
ordinary foreign-merge protection.

## Problem

BRANCH-2664 added a trusted integration-base route to `.claude/hooks/pre-push-check.sh`, but the real
Git hook reaches that guard through `runPostVerdictGuard()`. That bridge always synthesizes the bare
command `git push`, even when `HARNESS_BASE_REF` is present in its environment. The guard therefore
cannot see the declaration it intentionally binds to the push statement and rejects a valid child
whose merge ancestry is already contained by the trusted remote integration base.

## Source Constraints

- Keep `.claude/hooks/pre-push-check.sh` as the owner of trusted-base parsing and validation.
- Project only the exact environment value into the synthetic command; do not duplicate ref policy.
- Preserve bare `git push` for an absent declaration and preserve fail-closed handling for invalid
  or adversarial values.
- Cover the public Git-hook bridge, not only a direct shell-hook fixture.

## Plan

- [ ] TC-01 — Add a RED regression proving `runPostVerdictGuard` currently drops a valid declared base.
- [ ] TC-02 — Project one present `HARNESS_BASE_REF` into the synthetic push command while preserving
      the existing bare-command path when it is absent.
- [ ] TC-03 — Prove whitespace, shell metacharacters, quoting, or otherwise invalid declaration values
      cannot inject a second command and remain rejected by the existing trusted-base parser.
- [ ] TC-04 — Run the focused pre-push suites, plan-order scan, and affected repository scans.

## Test Plan

Exercise `runPostVerdictGuard` with a capturing shell stub for present and absent declarations, then
run the real trusted-integration fixture through the public pre-push route. Run the focused pre-push
Vitest files and affected harness scans against `origin/integration/agreement-2664`.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This changes repository-internal Git publication enforcement for contributors; it does
not alter any Robota CLI, TUI, browser, public SDK, or installed-package behavior an end user can run.
