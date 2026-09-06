---
title: 'INFRA-2631: Retire the non-functional Claude Code Review GitHub Action and its harness dependents'
status: todo
created: 2026-09-06
priority: medium
urgency: soon
area: 'CI/harness workflows and scans'
depends_on: []
issue: 2631
---

# INFRA-2631: Retire the non-functional Claude Code Review GitHub Action and its harness dependents


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

- [ ] Disable the `review` job in `.github/workflows/claude-code-review.yml` with a job-level `if: false` and a rationale comment, keeping the `uses:`/`with:`/`prompt:` content intact for provenance and quick re-enable.
- [ ] Extend `scripts/harness/scan-claude-review-coverage.mjs` to recognize a job-level `if: false` as a deliberate retirement and skip its shape/marker/prompt-language findings for that workflow, instead of failing the required `scans` job.
- [ ] Update `scripts/harness/scan-guard-scope-fail-closed.mjs`'s `MANDATORY_TREE_GUARDS` entry/tests for the coverage scan if its fail-closed assertion needs adjustment for the new retired-state branch.
- [ ] Add/adjust Vitest coverage in `scripts/harness/__tests__/scan-claude-review-coverage.test.mjs` for the retired (`if: false`) case, and confirm `scan-review-token-supply.mjs` and `scan-workflow-permissions.mjs` stay green unmodified (YAML content, including `github_token:` and `permissions:`, is left in place).
- [ ] Update `.agents/skills/pr-finding-resolution-loop/SKILL.md` and `.agents/skills/automated-review-convergence/SKILL.md` Round B prose so they no longer describe the retired action as "the reviewer on an open PR".
- [ ] Run `pnpm harness:scan`, the affected Vitest suites, and `pnpm harness:verify-like-ci` to confirm nothing else regresses.

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
