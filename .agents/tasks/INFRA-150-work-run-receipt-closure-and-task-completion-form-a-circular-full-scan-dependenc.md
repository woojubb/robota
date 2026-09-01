---
title: 'INFRA-150: Work-Run receipt closure and Task completion form a circular full-scan dependency'
issue: https://github.com/woojubb/robota/issues/2568
status: todo
created: 2026-09-02
priority: medium
urgency: soon
area: harness Work-Run lifecycle and Task/spec completion gates
depends_on: []
---

# INFRA-150: Work-Run receipt closure and Task completion form a circular full-scan dependency

## Objective

Define one repository-wide ordering contract for substantive verification, Task/spec terminalization,
Work-Run readiness and receipt-only closure, and the final full scan. The contract must remove the
moving-head cycle without weakening fail-closed Work-Run measurement.

The cycle was reproduced during INFRA-148: every substantive scan passed, while the only full-scan
failure was `work-run-measurement: invalid-closure-commit`. A terminal receipt cannot exist before
final verification, but completing and archiving the Task/spec after that receipt changes the bound
head again. This is a repository-wide sequencing defect, not an INFRA-148-specific scan exception.

## Scope Boundary

- Own the common lifecycle ordering rather than adding per-Task scan exclusions.
- Preserve exact head binding, receipt immutability, and fail-closed validation.
- Keep substantive verification mechanically enforceable before a Work-Run becomes ready.
- Provide a truthful final full-scan acceptance point after receipt closure.

## Plan

- [ ] Reproduce the cycle in contract tests using a Task/spec lifecycle change and a Work-Run receipt.
- [ ] Design one canonical ordering shared by backlog completion and Work-Run measurement.
- [ ] Update the owning rule/skill and scanners without introducing local Task exceptions.
- [ ] Verify substantive pre-completion checks and the final full scan both pass at their declared heads.

## Completion Criteria

- One documented and mechanically enforced sequence covers substantive verification, lifecycle
  terminalization, Work-Run `ready`, receipt-only closure, and final full-scan acceptance.
- No step requires evidence that can exist only after a later step changes the commit it binds.
- Existing missing, stale, or mutable Work-Run receipt failures remain fail closed.
- INFRA-148 and future Tasks can state their verification obligations without circular wording.

## Test Plan

- Add a regression fixture that reproduces the current moving-head cycle.
- Run focused Work-Run and task-lifecycle contract suites RED against the current ordering.
- Implement the shared ordering and prove those suites GREEN.
- Run contract, hermetic, build, and full-scan verification at the sequence points the new contract owns.

## User Execution Test Scenarios

Not applicable. This Task changes repository-internal lifecycle governance and exposes no Robota CLI,
TUI, browser, or public SDK behavior. Its observable proof belongs in harness contract tests.
