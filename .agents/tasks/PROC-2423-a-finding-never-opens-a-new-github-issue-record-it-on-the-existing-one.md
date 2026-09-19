---
title: 'PROC-2423: A finding never opens a new GitHub issue — record it on the existing one'
issue: https://github.com/woojubb/robota/issues/2423
status: todo
created: 2026-09-19
priority: medium
urgency: soon
area: .agents/rules, .agents/tasks, .agents/skills, scripts/harness
depends_on: []
---

# PROC-2423: A finding never opens a new GitHub issue — record it on the existing one

## Objective

Amend the rules so a finding made during work is recorded on the existing GitHub issue whose scope
contains it — a comment or a body update — and never as a new issue (the owner's direct instruction:
the tracker stays at its consolidated size). `finding-depth.md` owns the invariant; the documents and
the one allocator message that still named `gh issue create` point at it instead.

## Plan

- [x] TC-01: Correct the allocator's refusal message and pin it with a test case; prove the case red with the message reverted.
- [x] TC-02: Amend the rule, the boundary, the tasks README, the skill and the memory note, and run the affected scan suite in PR context.
- [x] TC-03: Run the whole allocator test file.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** Nothing a person runs in the product changes — no command, screen, output or setting; only the
repository's own rule documents and the harness allocator's refusal message change what an agent is told
to do with a finding.
