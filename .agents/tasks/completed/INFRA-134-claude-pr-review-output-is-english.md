---
title: 'INFRA-134: Claude PR review output is English'
status: done
created: 2026-08-27
completed: 2026-08-27
priority: medium
urgency: soon
area: GitHub Actions review automation and harness
depends_on: []
---

# INFRA-134: Claude PR review output is English

## Objective

Ensure the pull-request-only Claude Code Review workflow writes its PR summary and every inline
review comment in English, and mechanically reject future prompt edits that remove or mix the
language contract.

no-issue: captured directly from the owner request in this conversation.

## Plan

- [x] Translate the action-owned `prompt: |` block into English while preserving the exact review
      identity and actionable-finding markers.
- [x] Add an explicit instruction requiring the PR summary and every inline review comment to use
      English.
- [x] Extend the existing Claude review coverage scanner to reject a missing English instruction or
      any Hangul in the governed prompt, including an updated scanner scope description.
- [x] Add Vitest mutation coverage for both failure modes and run the targeted scanner, repository
      harness scan, and CI-owned actionlint command.

## Test Plan

- Run `pnpm exec vitest run scripts/harness/__tests__/scan-claude-review-coverage.test.mjs` after
  recording the RED state and again after implementation; both missing-contract and mixed-language
  mutations must be rejected in the final GREEN state.
- Run `node scripts/harness/scan-claude-review-coverage.mjs` against the checked-in workflow.
- Run `pnpm harness:scan` to verify all registered repository contracts and the existing exact
  review marker protocol.
- Run the actionlint invocation owned by `.github/workflows/ci.yml` against the translated workflow.

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

Not applicable — INFRA-134 changes only repository-owned GitHub Actions review instructions and the
internal harness scanner/tests that govern those instructions. It delivers no runnable behavior through
the canonical Robota CLI, TUI, browser UI, or public SDK/example surfaces. PR summaries and inline review
comments are repository review-automation artifacts rather than a shipped Robota product interface;
observing them on a hosted PR is CI/governance verification and therefore belongs with the engineering
evidence in `## Test Plan`, not the user-execution gate. No product capability is hidden behind an
unwired internal seam, so the capability-reachability exception does not apply.

### [DONE-GATE-STAGE-1] — ❌ FAIL | 2026-08-27

**Status remains:** scenario drafted
**Failed criteria:**

- Canonical product surface and invocation: Scenario 1 declares `product surface: github-pr-review` and
  `surface rationale: shipped-interface=github-pr-actions-review`, neither of which is one of the four
  canonical surface/rationale pairs owned by `backlog-execution.md`; it also provides neither a canonical
  single-line `command:` nor `browser steps:` invocation. The GitHub PR/API observation therefore cannot
  be bound as `guardian-observable-verdict=product-behavior` under the repository's Stage-1 contract.
  **Required action:** Re-author the applicability/surface decision using a permitted canonical product
  surface and matching invocation, or record the author-owned reasoned outcome if this repository-internal
  workflow change delivers no canonical runnable product surface.
- Agent executability: the declared `agent-executable` setup runs `git switch -c
chore/infra-134-review-language-fixture` while HEAD is the implementation branch. Repository branch
  policy requires feature branches to be cut from a freshly fetched `origin/develop`, and the branch guard
  rejects this command because no documented `BRANCH_GUARD_ALLOW_BASE=1` exception prefixes it.
  **Required action:** Redesign the fixture so every setup command is executable under the branch policy,
  or explicitly document and narrowly apply an allowed exception with its rule-consistent reason.
- Repository-rule safety: the deliberate patch makes a verification scanner silently return zero findings
  whenever `CI` is set. That fixture behavior deliberately violates the repository's mandatory “Silence is
  not success” enforcement rule; being confined to an unmerged disposable branch is not a documented rule
  exemption.
  **Required action:** Use a safe review target that does not make a governed verifier silently succeed on
  a real defect or otherwise conflict with repository rules.
- Exact expected-observable proof: the expected result requires an inline comment pointing to the
  deliberate scanner-bypass line, but the comparison script only checks that at least one action-authored
  inline comment exists; it never verifies the comment path, line, or diff target.
  **Required action:** Make the executable comparison bind the observed inline comment to the exact intended
  path and added line, as well as checking its complete language output.

## Verification Evidence

- TDD RED: the missing-contract mutation failed with 1 failed / 15 passed tests before the scanner
  enforced the contract; the Hangul mutation then failed with 1 failed / 16 skipped tests before the
  Hangul detector was added.
- Targeted GREEN: `pnpm exec vitest run scripts/harness/__tests__/scan-claude-review-coverage.test.mjs`
  passed 17/17 tests.
- Live guard: `node scripts/harness/scan-claude-review-coverage.mjs` examined one governed workflow and
  returned `claude-review-coverage: PASS`.
- Repository contracts: `pnpm harness:scan` passed 145 scans with two declared skips and no failures.
- Workflow syntax: the CI-pinned actionlint 1.7.7 archive matched SHA-256
  `023070a287cd8cccd71515fedc843f1985bf96c436b7effaecce67290e7e0757`; its repository-wide `-color`
  invocation exited 0 with no findings.
- Develop CI mirror: `pnpm harness:verify-like-ci -- --base-ref origin/develop` passed all 13 local
  stages in 6m 17.8s, including the monorepo build, workspace typecheck, lint ceiling, examples
  typecheck, 27/27 TUI PTY tests, 3,922/3,922 harness contract tests, and 1,149/1,149 hermetic tests.
  Dependency audit, a real Windows runner, workflow provenance, and PR CodeQL review-gate remain
  remote-only by the mirror's explicit contract.
- Pre-push local review found that the original explicit ranges missed Hangul Jamo Extended-A and
  Halfwidth Hangul. Mutation tests for `U+A960` and `U+FFA1` failed before the correction; the guard
  now uses Unicode `Script=Hangul`, and the complete targeted suite passes 19/19 tests.
