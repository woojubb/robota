---
title: 'RULE-2795: Two rule documents own error modelling and disagree, so one package now carries three conventions'
issue: https://github.com/woojubb/robota/issues/2795
status: todo
created: 2026-09-21
area: .agents/rules
priority: medium
urgency: soon
depends_on: []
---

# RULE-2795: Two rule documents own error modelling and disagree, so one package now carries three conventions

## Objective

`operational.md` mandates `Result<T, E>` for fallible public functions; `common-mistakes.md` (entry 57)
permits either and records "Mechanism: none". `AGENTS.md` requires exactly one owner per fact.
Nothing checks either, so the answer is chosen per function — and `agent-mcp` alone now carries
three conventions for one class of operator error.

## Plan

- [ ] Decide which document owns error modelling and delete the claim from the other
- [ ] Give the decision a mechanical check
- [ ] Converge `agent-mcp` first — it is small and self-contained
- [ ] Remove the containment note from `overlay.ts`

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** Pending design. This Task records a cause found during the MCP-001 review and filed under finding-depth.md; its user-execution disposition is decided when the change is planned, not when the cause is recorded.
