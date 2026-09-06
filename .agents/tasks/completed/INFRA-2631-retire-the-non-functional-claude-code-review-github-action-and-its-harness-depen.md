---
title: 'INFRA-2631: Retire the non-functional Claude Code Review GitHub Action and its harness dependents'
status: done
created: 2026-09-06
priority: medium
urgency: soon
area: 'CI/harness workflows and scans'
depends_on: []
issue: 2631
completed: 2026-09-06
---

# INFRA-2631: Retire the non-functional Claude Code Review GitHub Action and its harness dependents

Spec: `.agents/spec-docs/done/INFRA-2631-retire-the-non-functional-claude-code-review-github-action-and-its-harness-depen.md`

## Objective

Treat the `anthropics/claude-code-action`-driven `.github/workflows/claude-code-review.yml` (the
automated lightweight PR-review pass) as permanently non-functional per owner directive, disable it
without deleting its provenance, and disable/adjust every harness mechanism that would otherwise
start failing or blocking once the action stops posting reviews — while leaving the mandatory local
`/code-review` merge gate (`git-branch.md` § Pre-Merge Code-Review Gate) untouched, since it does not
depend on this action.

no-issue: captured directly from the owner request in this conversation (issue #2631 opened by the
allocator to back this Task/spec pair).

## Plan

- [x] Disable the `review` job in `.github/workflows/claude-code-review.yml` with a job-level
      `if: false` plus the `CLAUDE-CODE-REVIEW: RETIRED (INFRA-2631)` marker comment, keeping the
      `uses:`/`with:`/`prompt:` content intact for provenance and quick re-enable.
- [x] Extend `scripts/harness/scan-claude-review-coverage.mjs` (`isRetiredJob`/`RETIRED_MARKER`) to
      recognize the marker + `if: false` pairing as a deliberate retirement and skip its
      shape/marker/prompt-language findings for that workflow, instead of failing the required
      `scans` job.
- [x] Checked `scripts/harness/scan-guard-scope-fail-closed.mjs`'s `MANDATORY_TREE_GUARDS` entry for
      the coverage scan: it only asserts fail-closed behavior when the `.github/workflows` tree
      itself is absent, a branch this change does not touch — no adjustment needed; confirmed by
      running `pnpm harness:scan` (that specific `guard-scope-fail-closed` check still passes).
- [x] Added Vitest coverage in `scripts/harness/__tests__/scan-claude-review-coverage.test.mjs` for
      the retired case (marker+`if:false` passes; `if:false` alone without the marker still fails)
      and confirmed `scan-review-token-supply.mjs` and `scan-workflow-permissions.mjs` stay green
      unmodified (YAML content, including `github_token:` and `permissions:`, is left in place).
- [x] Updated `.agents/skills/pr-finding-resolution-loop/SKILL.md` and
      `.agents/skills/automated-review-convergence/SKILL.md` Round B prose so they no longer describe
      the retired action as "the reviewer on an open PR" / a "bot review comments" source.
- [x] Ran `pnpm harness:scan` (full) and the affected-scope scan
      (`run-all-scans.mjs --affected --context pr --base-ref origin/develop`); the only red findings
      in both are pre-existing, unrelated baseline debt on files this change never touches
      (`unearned-done-claims`, `task-plan-items`, `backlog-placement`, `dist`, and file-size drift on
      `allocate-work-item-id.mjs`/`new-spec.mjs`/`scan-guard-scope-fail-closed.mjs`/
      `work-run-store.mjs`/`run-all-scans.mjs`) — confirmed via `git diff --stat` that none of those
      paths are in this change's diff. `guard-scope-fail-closed` itself passes.

## Test Plan

- `pnpm exec vitest run scripts/harness/__tests__/scan-claude-review-coverage.test.mjs` — RED before
  the retirement branch is added (mutation: job `if: false` still reports shape findings), GREEN after.
- `node scripts/harness/scan-claude-review-coverage.mjs`, `node scripts/harness/scan-review-token-supply.mjs`,
  `node scripts/harness/scan-workflow-permissions.mjs` against the live disabled workflow.
- `pnpm harness:scan` (registered scan suite, full).
- `pnpm harness:verify-like-ci -- --base-ref origin/develop` (develop CI mirror).
- actionlint against the edited workflow file (same pinned invocation `ci.yml` owns).

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This item disables a repository-owned GitHub Actions review workflow and adjusts internal
harness enforcement scripts. It exposes no runnable behavior through the canonical Robota CLI, TUI,
browser UI, or public SDK/example surfaces — a hosted PR's absence of an automated review comment is
repository CI/governance evidence, not a shipped Robota product interface, so verification stays in
the engineering Test Plan above (same precedent as INFRA-134).
