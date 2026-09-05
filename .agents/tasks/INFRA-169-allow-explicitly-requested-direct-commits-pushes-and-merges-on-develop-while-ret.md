---
title: 'INFRA-169: Allow explicitly requested direct commits, pushes, and merges on develop while retaining main/master protections'
status: in-progress
created: 2026-09-06
priority: medium
urgency: soon
area: .agents/rules, .claude/hooks, .husky
depends_on: []
---

# INFRA-169: Allow explicitly requested direct commits, pushes, and merges on develop while retaining main/master protections

## Objective

Align the branch-policy document and local commit guard with the maintainer-authorized workflow:
`develop` may receive explicitly requested direct commits, pushes, and merges, while `main` and
`master` remain protected.

## Plan

- [x] Update the branch-policy wording.
- [x] Permit `develop` in the command-string and git-native commit guards.
- [ ] Run focused shell checks and the repository scan.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This changes repository-maintainer workflow enforcement and local Git hooks; it has no
end-user runtime surface, CLI behavior, SDK contract, or product-facing interaction to execute.

## Verification

- Focused static assertions must show `main`/`master` remain blocked and `develop` is not blocked by
  either commit guard.
- `pnpm harness:scan` must pass for the final tree.
