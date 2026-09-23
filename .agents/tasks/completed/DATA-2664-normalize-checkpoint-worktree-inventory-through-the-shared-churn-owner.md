---
title: 'DATA-2664: Normalize checkpoint worktree inventory through the shared churn owner'
issue: https://github.com/woojubb/robota/issues/2664
status: done
created: 2026-09-20
completed: 2026-09-20
priority: high
urgency: now
area: scripts/harness checkpoint evidence and verification receipt storage
depends_on: [BEHAVIOR-2664]
---

# DATA-2664: Normalize checkpoint worktree inventory through the shared churn owner

## Current disposition — 2026-09-23

Historical delivery is preserved at replacement child merge `2d4eaff7cf39540209d085a3ae43968834c6c9d1` in R `720eb5e841ba7a5361ac667b9658e034212bb58e`. The done status and original evidence below describe that delivery; importing this record does not restore its historical implementation. PR #2827 (`2a4a84631d24243d8dfb8ef75e04d790e8d60d37`) deliberately retired the legacy gate, checkpoint, and recommendation machinery. This record is historical evidence of a completed child, not an active instruction to recreate its gate, checkpoint, endorsement, or frozen-corpus enforcement machinery.

Spec: `.agents/spec-docs/done/DATA-2664-normalize-checkpoint-worktree-inventory-through-the-shared-churn-owner.md`

## Objective

Ensure GATE-IMPLEMENT checkpoint producers and consumers share the repository's single definition of
real working-tree dirt, so auto-generated lesson churn cannot be recorded in a PASS that validation
immediately rejects or that permanently blocks a continuation retry.

## Source Constraints

- `verification-receipt-storage.mjs` remains the owner of ignored auto-generated churn.
- Real unexpected dirt must continue to fail closed.
- Existing valid v1/v2 checkpoint evidence remains readable and append-only.

## Plan

- [x] TC-01 — Reproduce dirty auto-generated lesson files during first and continuation checkpoint generation.
- [x] TC-02 — Make checkpoint inventory consume the shared real-dirt classifier without copying its allowlist.
- [x] TC-03 — Prove generated payloads pass `worktreeError` while one real unrelated path still fails.
- [x] TC-04 — Verify retry behavior does not become trapped by tool-produced invalid evidence.
- [x] TC-05 — Run the focused checkpoint/receipt suites and affected harness verification against the child branch base.
- [x] TC-06 — Run the affected harness scan against `origin/integration/agreement-2664` and record its result.

## Test Plan

Add focused checkpoint producer/consumer fixtures covering both ignored churn files, an unrelated dirty
path, and prior-entry validation. Run the verification receipt, checkpoint evidence, and gate Vitest
suites plus affected harness verification.

## Progress

- 2026-09-20 — GATE-IMPLEMENT checkpoint preparation: pair-owned activation metadata is ready; no implementation path has changed.
- 2026-09-20 — Shared real-dirt classification now feeds all checkpoint inventory forms; 122 focused tests and the 63-scan affected PR selection pass, with two pre-existing advisories tolerated by PR context.
- 2026-09-20 — Rebased the unpushed port onto `origin/integration/agreement-2664@634ff8cfe`; 122 focused tests, 61 affected scans plus one skip, and the 9-commit plan-order check pass on the current base.

## User Execution Test Scenarios

Not applicable.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This changes repository-internal checkpoint evidence generation and validation, not any
Robota CLI, TUI, browser, public SDK, or installed-package behavior visible to an end user.
