---
title: 'INFRA-090: post-promotion whole-repository format normalization'
status: in-progress
created: 2026-08-13
priority: medium
urgency: next
area: repository-wide formatting
depends_on: [INFRA-089]
---

# INFRA-090 — post-promotion whole-repository format normalization

## Objective

After all earlier functional branches, including `feat/arch-dag-runtime-completion`, have reached
`main`, create a fresh branch from the updated integration head and run the new `pnpm lint:fix` full
sweep. Keep the resulting mechanical normalization isolated from functional changes so it cannot make
those branches harder to merge.

## Plan

- [x] Confirm no functional feature branch remains unmerged and the latest develop content is promoted to main.
- [x] Create a fresh normalization branch from freshly fetched `origin/develop`.
- [x] Record the clean pre-run baseline, run `pnpm lint:fix`, and inventory every changed path.
- [x] Review the broad diff for semantic changes or generated/ignored artifacts; exclude anything not owned by the formatter scope.
- [x] Run `pnpm lint:fix` a second time and prove the tree is idempotent.
- [ ] Run `pnpm harness:verify-like-ci`, commit, PR to develop, merge, and promote develop to main.

## Test Plan

The first full run must exit 0 and produce only ESLint/Prettier-owned mechanical changes. A second full
run must leave `git diff` byte-identical. The post-fix tree must pass `pnpm harness:verify-like-ci` before
commit, then required CI must pass on the exact pushed SHA before each merge hop.

## User Execution Test Scenarios

Not applicable. This is repository normalization with command output, diff inventory, idempotence, and CI
evidence as its observables.

## Progress

### 2026-08-13

- Filed after the owner corrected sequencing: functional branches must reach main before the broad sweep.
- A premature full sweep on the current dirty branch was fully reverted; the status set matched the saved
  pre-run baseline exactly (25 paths before and after, zero extra and zero missing).
- PRs #1697 and #1699 reached `develop`; regenerated promotion PR #1700 passed the required main
  source, ancestry, and release-grade gates and merged at `faeaab54a`. All feature, fix, and promotion
  branches were then removed locally and remotely; only `main` and `develop` remained.
- Created `chore/whole-repository-lint-fix` from fresh `origin/develop`. The full sweep exited `0`
  and normalized 229 files (5,395 insertions, 5,058 deletions) across repository-owned ESLint and
  Prettier scopes. A third execution produced the same diff hash as the second
  (`f5290a14303e08bda4ceacdad6916ec7e074101f5da0bd313b373476515c9a99`), proving convergence.
- The first `harness:verify-like-ci` run passed every build, test, typecheck, lint, binary, example,
  and TUI stage. Its two scan-suite wrappers both reported the same seven `ratchet-tighten`
  findings: formatting had reduced those files' line counts. Regenerated the repository-owned
  file-size baseline with the scan's prescribed `--write-baseline` command; all seven changes only
  lower existing ceilings, and the focused file-size scan now passes with 90 burn-down entries.

## Decisions

- Never combine this broad normalization with an earlier functional branch.

## Blockers

- `feat/arch-dag-runtime-completion` and INFRA-089 must reach main first.

## Result

Pending.
