---
title: 'ARCH-034: in-process and child-process subagents get different tool surfaces'
status: todo
created: 2026-08-16
priority: medium
urgency: later
area: packages/agent-framework, packages/agent-subagent-runner
depends_on: []
issue: https://github.com/woojubb/robota/issues/1785
---

# ARCH-034: in-process and child-process subagents get different tool surfaces

## Problem

Found by `proposal-reviewer` while testing ARCH-021's premises. Filed rather than folded in: real,
but not #1777's cause, and ARCH-021 neither creates nor worsens it.

The in-process subagent runner inherits session-level extras the child-process path does not —
background process, goal tool, projected command tools, checkpoint wrappers. So two runners of the
same `ISubagentRunner` contract give a subagent different tool surfaces depending on which one the
composition root selected.

That is a contract-conformance problem in its own right: the choice of runner is supposed to be an
isolation/packaging decision, not a capability decision.

## Blockers

- None.

## Result

Pending.
