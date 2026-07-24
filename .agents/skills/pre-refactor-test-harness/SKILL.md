---
name: pre-refactor-test-harness
description: Before modularizing or refactoring a package, analyze the code for extraction points, write characterization tests for current behavior, then modularize under test protection. Use when a package has monolithic files that need to be broken into testable modules.
---

# Pre-Refactor Test Harness

## Rule Anchor

- `AGENTS.md` > "Test-Driven Development"
- `AGENTS.md` > "Build Requirements"
- `AGENTS.md` > "No Fallback Policy"

**Never refactor without tests. Never modularize without first proving the current behavior is
captured.** The sequence is always: **Analyze → Test → Extract → Verify**.

## Phases

### 1. Analyze (no code changes)

Catalog each responsibility block in the target file(s) and classify it: pure logic (immediately
extractable, highest test value — P1), I/O behind an interface (P2), framework-coupled (P3 — may
need architectural discussion). Present the proposed module structure and get user approval before
proceeding.

### 2. Characterization tests (before any refactoring)

Write tests capturing the **current** behavior of each P1 target (input→output contracts, edge
cases, error paths; RED tests against the extracted signature if the code is inline-untestable).
Run them, then **commit the tests separately** before any extraction — this preserves the rollback
point (`test(<pkg>): add characterization tests for <target> before refactor`).

### 3. Extract (one module per commit)

Extract one target at a time — pure move only, no behavior change ("while I'm here" fixes are the
classic failure). Run the package tests + build after each extraction and commit each individually
(`refactor(<pkg>): extract <module> from <source>`). P1 first; P2 needs its interface defined
before the move.

### 4. Verify

Full `pnpm build && pnpm test && pnpm typecheck`, then update SPEC.md file structure →
[spec-code-conformance](../spec-code-conformance/SKILL.md).

## Stop Conditions

- No extraction without tests covering it; no multi-module commits; no behavior change during
  extraction; no skipping the analysis phase or user approval of the plan.

## Related Skills

- [tdd-red-green-refactor](../tdd-red-green-refactor/SKILL.md) — TDD cycle for NEW behavior after extraction.
- [repo-change-loop](../repo-change-loop/SKILL.md) — the shared build/test/verify loop.
- [vitest-testing-strategy](../vitest-testing-strategy/SKILL.md) — testing patterns and conventions.
