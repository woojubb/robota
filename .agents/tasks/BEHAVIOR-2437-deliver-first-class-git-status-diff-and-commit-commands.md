---
title: 'BEHAVIOR-2437: Deliver first-class Git status diff and commit commands'
issue: https://github.com/woojubb/robota/issues/2437
status: todo
created: 2026-09-14
priority: high
urgency: now
area: packages/agent-command, packages/agent-cli
depends_on: []
---

# BEHAVIOR-2437: Deliver first-class Git status diff and commit commands

## Objective

Retain a first-class Git command family because it provides structured, argument-safe status and diff output
plus an explicit commit confirmation boundary that raw `/shell` does not. Implement it through current command
modules without treating arbitrary arguments as shell text or staging additional files implicitly.

## Plan

- [ ] Implement parsed `/status` output for staged, unstaged and untracked files.
- [ ] Implement `/diff`, `/diff --staged` and explicit revision/range views with strict argv execution.
- [ ] Implement `/commit` over the existing staged set only with conventional-message validation and confirmation.
- [ ] Cover invalid revisions, empty staged state, refusal, success and a real temporary-repository scenario.

## Test Plan

Use temporary Git repositories and injected confirmation to prove argument safety and state transitions; run
command package tests and a headless/PTY CLI scenario exercising status, diff and commit.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`

In a temporary repository, create staged, unstaged and untracked files; run `/status`, all `/diff` variants,
refuse one `/commit`, accept another and verify only the intended staged state was committed.
