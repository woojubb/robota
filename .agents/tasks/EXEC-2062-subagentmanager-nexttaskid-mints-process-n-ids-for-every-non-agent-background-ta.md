---
title: 'EXEC-2062: SubagentManager.nextTaskId mints process_N ids for every non-agent background task kind, so scheduled and tool-call tasks are named as processes'
issue: https://github.com/woojubb/robota/issues/2062
status: todo
created: 2026-09-22
priority: medium
urgency: soon
area: background-task ids and kind vocabulary
depends_on: []
---

# EXEC-2062: SubagentManager.nextTaskId mints process_N ids for every non-agent background task kind, so scheduled and tool-call tasks are named as processes

## Objective

`SubagentManager.nextTaskId` (`packages/agent-executor/src/subagents/subagent-manager.ts:143-160`) is the
`idFactory` the product runtime installs on its `BackgroundTaskManager`, and it names every non-`agent`
request `process_N`. That was already wrong for `scheduled` tasks and becomes visibly wrong for the
`tool-invocation` kind MCP-004 adds: a handed-off MCP call appears in `/tasks` as `process_7`. Ids are minted in
one place (the manager's `idFactory`), so the fix is one kind-aware naming rule there, and it belongs to
the AGREEMENT-009 kind-safe migration whose contract map (DATA-010) is where the per-kind prefix should
be declared.

## Plan

- [ ] Name ids by kind in `SubagentManager.nextTaskId` (`agent_`, `process_`, `scheduled_`, `tool_invocation_`), reading the prefix from the kind-indexed map once DATA-010 lands, or from an exhaustive switch until then.
- [ ] Add a test asserting the prefix per kind and that an unknown kind is a compile error, not a `process_` default.
- [ ] Check every consumer that parses task ids by prefix (`rg "process_" packages/*/src`) and update or prove none depends on the prefix.

## Evidence

- Found by `proposal-reviewer` during the MCP-004 design review, 2026-09-22 (premise check 3): "`subagent-manager.ts:154-160` mints `process_N` ids for every non-agent kind".
- Filed as a separate root item rather than folded into MCP-004 (finding-depth.md): the defect predates the new kind and lives in the AGREEMENT-009 migration's area.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** Harness-internal to the task manager's id minting; the only user-visible effect is the prefix of a task id in `/tasks`, which the MCP-004 scenario and the AGREEMENT-009 migration's own scenarios observe — no separate runnable surface exists for an id prefix.
