---
title: "DELIVERY-2525: a completed background task's output reaches /tasks and the TUI but never the model unless the task wakes the loop, so a handed-off MCP result is invisible to the conversation that asked for it"
issue: https://github.com/woojubb/robota/issues/2525
status: todo
created: 2026-09-22
priority: medium
urgency: soon
area: background-task result delivery to the model
depends_on: []
---

# DELIVERY-2525: a completed background task's output reaches /tasks and the TUI but never the model unless the task wakes the loop, so a handed-off MCP result is invisible to the conversation that asked for it

## Objective

When a background task completes, its output reaches `/tasks`, `readTaskDetail` and the TUI through the
execution-workspace projection (`interactive-session-background-tracker.ts:295-333`), but the MODEL is
re-entered only by `background_task_waking` (`:78`, FLOW-002). A long MCP call handed off by MCP-004
therefore returns its text to the user's task list, not to the conversation that asked for it; Claude
Code's documented behaviour hands the settled result back to the model as a task notification
(https://code.claude.com/docs/en/mcp). Issue #2524's acceptance criteria are met without this (they name
"the existing notification path"), but the parent checklist line's intent — the model keeps working and
gets the result — is only half met until a completed task's result can be injected into the loop as a
model-visible notification, generically for every kind, with the same effectively-once guarantee.

## Plan

- [ ] Decide, under umbrella issue #2525, whether a completed `tool-call` (and by extension `process`/`agent`) result should re-enter the loop as a model-visible notification, and how it composes with `background_task_waking`.
- [ ] Specify the injection point (one generic path in `agent-framework`, keyed by task id, idempotent) and its opt-out.
- [ ] Add the functional test through `scriptedSession()` proving the model sees the result exactly once.

## Evidence

- Found by `proposal-reviewer` during the MCP-004 design review, 2026-09-22 (§ Scope, separate root items): "Completed background output is never delivered to the model … only `background_task_waking` re-enters the loop".
- Filed separately from MCP-004 (finding-depth.md): a generic notification-path decision, not an MCP-004 defect.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** Not a runnable surface on its own yet: the decision is whether a generic model-facing delivery path should exist; once it does, the MCP-004 scenario (`pnpm scenario:verify:mcp-background`) is the surface that would show the model receiving the result.
