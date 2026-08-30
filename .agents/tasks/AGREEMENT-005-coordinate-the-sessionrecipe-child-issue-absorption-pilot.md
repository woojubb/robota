---
title: 'AGREEMENT-005: coordinate the SessionRecipe child-issue absorption pilot'
issue: https://github.com/woojubb/robota/issues/2063
status: in-progress
created: 2026-08-30
priority: high
urgency: soon
area: agent-framework session construction
depends_on: []
children: [ARCH-113, ARCH-114, ARCH-115]
---

# AGREEMENT-005: coordinate the SessionRecipe child-issue absorption pilot

## Objective

Replace issue #2063's GitHub-only implementation tree with one governed relationship owner while
preserving the external problem under canonical issue #2079. The three executable causes remain
independently verifiable Tasks; this migration does not implement them or claim their outcomes are
delivered.

## Children

- [ ] ARCH-113 — todo — `.agents/tasks/ARCH-113-introduce-the-sole-sessionrecipe-construction-kernel.md`
- [ ] ARCH-114 — todo — `.agents/tasks/ARCH-114-route-query-and-agentruntime-factories-through-sessionrecipe.md`
- [ ] ARCH-115 — todo — `.agents/tasks/ARCH-115-route-interactive-runtime-through-sessionrecipe-and-remove-the-public-test-escap.md`

## Plan

- [x] TC-01 — Freeze the complete 78-row prerequisite manifest with all rows held and no mutation authority.
- [x] TC-02 — Land AGREEMENT-005 and ARCH-113/114/115 on `develop` with the declared dependency order.
- [x] TC-03 — Apply and immediately read back the four-row B1 Issue/body/state migration only after a fresh review.
- [x] TC-04 — Reconcile the live hierarchy from 77 to 73 open children and account for all original 78 rows, including issue #2514 as already `CLOSED/COMPLETED`.
- [x] TC-05 — Land the B1 repository evidence while keeping B2/B3/B4 Issue state unchanged.
- [ ] TC-06 — Keep AGREEMENT-005 `in-progress` until ARCH-113, ARCH-114, and ARCH-115 each have `status: done`, a `completed:` date, and their exact record under `.agents/tasks/completed/`; then update and read back GitHub issue #2079's rows for GitHub issue #2084, GitHub issue #2102, and GitHub issue #2115 so each names its exact completed Task path through a resolvable full-SHA blob link before completing this AGREEMENT.

After the migration pilot, deliver ARCH-113 as the sole normalized construction kernel, ARCH-114 after
ARCH-113, and ARCH-115 after both predecessors. Close this AGREEMENT only when all three child Tasks are
done and issue #2079's current execution map reflects their terminal evidence.

## B1 Migration Evidence

- Authorization commit: `0c4d1cb6c4e50f14d53dae7abb71a3b178882bf5`; exact approved set
  `{issue #2063, issue #2084, issue #2102, issue #2115}`.
- Parent issue #2079 contains the complete 55-row execution-owner map; body SHA-256
  `d8e48e72abbd8c3b1303e9302e96ec5a16fd41dec6a642f728215a342f74f816`.
- All four exact Task markers were read back before `priority:P1` removal. Every B1 row then read back
  `CLOSED/NOT_PLANNED` with the `enhancement` label, native parent, and dependency edges intact.
- The official audit exited 0 with 277 open Issues and 73 open native children. No rollback was triggered.
- Evidence PR #2554 passed all 11 required checks and merged as
  `cc20654da1aad9f48c8cc57ee210275e58fc0a7d`. Independent post-merge verification found its complete
  tree byte-identical to reviewed head `f82f90d83ec5ac775b894fa1629d1530b691b7ce`; a fresh audit remained
  at 277/73 with B2 51/51, B3 17/17, and B4 5/5 unchanged.

## Constraints

- Preserve the dependency order `ARCH-113 → ARCH-114 → ARCH-115`.
- Do not add compatibility shims or forwarding constructor facades for the prerelease API.
- Keep executable detail in the three child Tasks; issue #2079 remains the external problem record.

## Test Plan

- Verify each child independently under its own package tests and affected-scope build.
- Verify the repository constructor guard permits exactly the intended kernel production site.
- Assert each child has `status: done`, a `completed:` date, and its exact file under `.agents/tasks/completed/`, with the former active path absent.
- Fetch GitHub issue #2079's body, parse the `Related execution records` table, and assert these exact mappings plus a resolvable full 40-hex commit-SHA blob link to the same path in each row:
  - GitHub issue #2084 → ARCH-113's exact current basename moved under `.agents/tasks/completed/`
  - GitHub issue #2102 → ARCH-114's exact current basename moved under `.agents/tasks/completed/`
  - GitHub issue #2115 → ARCH-115's exact current basename moved under `.agents/tasks/completed/`
- Run `pnpm harness:scan` and affected verification before each delivery PR merges.

## User Execution Test Scenarios

Not applicable to this migration-only AGREEMENT record. Each child Task owns the observable runtime
scenario for the factory surface it changes; this parent verifies only their relationship and terminal
evidence.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** Not applicable because this checkpoint and migration pilot change repository governance
records and GitHub Issue administration only. They introduce no runnable Robota product behavior,
public API, command output, TUI/browser flow, or end-user interface.
