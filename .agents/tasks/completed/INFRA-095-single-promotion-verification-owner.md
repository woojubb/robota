---
title: 'INFRA-095: make protected CI the single promotion verification owner'
status: done
created: 2026-08-14
completed: 2026-08-14
priority: high
urgency: now
area: scripts/harness/promote.mjs, .agents/rules
depends_on: []
---

# INFRA-095: make protected CI the single promotion verification owner

**Spec:** [active design](../spec-docs/active/INFRA-095-single-promotion-verification-owner.md)

## Plan

- [x] TC-01 — Remove automatic local release-grade execution and its bypass flag from promotion assembly.
- [x] TC-02 — Preserve clean-tree, fetch, merge-tree, ancestry, tree-equivalence, and branch rollback gates.
- [x] TC-03 — Keep `pnpm harness:verify:release` as the protected main-PR CI owner and explicit diagnostic command.
- [x] TC-04 — Update promotion tests, current rules, and mirror ownership so they reject duplicate automatic execution.
- [x] TC-05 — Run focused and full engineering verification and record measured evidence.

## Progress

### 2026-08-14

- Measured the duplicate path: local `promote.mjs` runs `pnpm harness:verify:release`, then the
  required main-PR `release-grade verification` job runs the byte-identical command again.
- Chose the bounded repository-only correction: keep the promotion PR and protected CI, while the
  local assembler owns only deterministic ancestry/tree preparation. The separate INFRA-054
  fast-forward end state remains open because it requires external ruleset identity and owner policy decisions.
- Removed the automatic release child and bypass flag. Added real-origin fetch coverage plus
  post-merge rollback coverage for a distinct branch, the checked-out target branch, and detached HEAD.
- Focused promotion/required-check tests pass 50/50 and `pnpm harness:scan` passes 108 scans.
- Final `pnpm harness:verify-like-ci` passed all 12 stages in 4m 7.3s after Prettier auto-fix;
  repository-contract 2,232/2,232 and hermetic 1,055/1,055 tests passed.

## Blockers

None.

## Test Plan

- RED: current promotion tests and parity test require a local release-gate child and bypass flag.
- GREEN: scratch repositories prove the assembler still fails closed for dirty, drifted, conflicting,
  and invalid refs while a ready branch no longer spawns the release command.
- Regression: parsed workflow tests prove the protected main job still owns exactly one
  `pnpm harness:verify:release` invocation and the local diagnostic entry remains reachable.
- Final: `pnpm harness:scan`, focused Vitest, and `pnpm harness:verify-like-ci` exit 0.

## User Execution Test Scenarios

Not applicable — this changes repository-internal release preparation and protected CI ownership,
not a shipped CLI, TUI, browser, application, or public SDK behavior. Promotion commands and CI
results are engineering/governance verification and are recorded in the Test Plan.

## Result

Protected main-PR CI is now the sole automatic release-verification owner. Promotion assembly keeps
all structural and ancestry gates, including exact rollback of pre-existing and detached states;
the full local release command remains available as an explicit diagnostic.
