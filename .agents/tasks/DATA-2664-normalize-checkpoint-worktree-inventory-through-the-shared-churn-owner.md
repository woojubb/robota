---
title: 'DATA-2664: Normalize checkpoint worktree inventory through the shared churn owner'
issue: https://github.com/woojubb/robota/issues/2664
status: todo
created: 2026-09-20
priority: high
urgency: now
area: scripts/harness checkpoint evidence and verification receipt storage
depends_on: [BEHAVIOR-2664]
---

# DATA-2664: Normalize checkpoint worktree inventory through the shared churn owner

## Objective

Ensure GATE-IMPLEMENT checkpoint producers and consumers share the repository's single definition of
real working-tree dirt, so auto-generated lesson churn cannot be recorded in a PASS that validation
immediately rejects or that permanently blocks a continuation retry.

## Source Constraints

- `verification-receipt-storage.mjs` remains the owner of ignored auto-generated churn.
- Real unexpected dirt must continue to fail closed.
- Existing valid v1/v2 checkpoint evidence remains readable and append-only.

## Plan

- [ ] TC-01 — Reproduce dirty auto-generated lesson files during first and continuation checkpoint generation.
- [ ] TC-02 — Make checkpoint inventory consume the shared real-dirt classifier without copying its allowlist.
- [ ] TC-03 — Prove generated payloads pass `worktreeError` while one real unrelated path still fails.
- [ ] TC-04 — Verify retry behavior does not become trapped by tool-produced invalid evidence.

## Test Plan

Add focused checkpoint producer/consumer fixtures covering both ignored churn files, an unrelated dirty
path, and prior-entry validation. Run the checkpoint evidence and user-execution-plan-order Vitest suites
plus affected harness verification.

## User Execution Test Scenarios

Not applicable.

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** This changes repository-internal checkpoint evidence generation and validation, not any
Robota CLI, TUI, browser, public SDK, or installed-package behavior visible to an end user.
