---
title: 'INFRA-042: nightly mutation testing (Stryker) over core packages'
status: todo
created: 2026-07-22
priority: low
urgency: later
area: .github/workflows, packages
depends_on: ['INFRA-041']
---

# Nightly mutation testing (Stryker) over core packages

## Problem

The deepest defense against weak / accidental-green tests (the class that recurred twice — ARCH-004
RUNTIME-14, CORE-026 RUNTIME-12; see [common-mistakes.md](../rules/common-mistakes.md) #82): mutation testing
mutates the source (flip a `>` to `>=`, drop a statement, negate a condition) and re-runs the suite; a mutant
that **survives** means no test noticed the change — i.e. a test that does not actually pin the behavior.
Coverage says a line ran; mutation says a line's behavior is _asserted_.

Deliberately deferred and SCOPED — mutation runs the suite once per mutant, so it is far too expensive for
per-PR CI. Run it nightly/weekly over a bounded set.

## What

1. Add `@stryker-mutator/core` + the vitest runner (`@stryker-mutator/vitest-runner`).
2. A `stryker.conf` scoped to the highest-value core packages first (e.g. `agent-core` permissions/gate,
   `agent-session` permission-enforcer, `agent-executor` state-machine) — NOT the whole monorepo.
3. A scheduled workflow (`on: schedule` nightly + manual `workflow_dispatch`), not `pull_request`. Publish the
   mutation score + surviving-mutant report as an artifact / summary.
4. Set a starting mutation-score threshold advisory-only; ratchet up over time. Surviving mutants become
   test-hardening work items.

## Test Plan

- A known-weak test (asserts a late invariant) leaves a surviving mutant that Stryker reports; hardening the
  test kills it. Validate on one package before widening scope.

## User Execution Test Scenarios

- Not applicable (scheduled CI quality job; the report is the maintained artifact).
- Evidence: the first nightly run's mutation-score report over the scoped packages.
