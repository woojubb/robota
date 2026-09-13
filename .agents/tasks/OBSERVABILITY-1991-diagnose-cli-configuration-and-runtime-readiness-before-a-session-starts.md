---
title: 'OBSERVABILITY-1991: Diagnose CLI configuration and runtime readiness before a session starts'
issue: https://github.com/woojubb/robota/issues/1991
status: todo
created: 2026-09-14
priority: high
urgency: now
area: packages/agent-cli, packages/agent-framework, packages/agent-command
depends_on: []
---

# OBSERVABILITY-1991: Diagnose CLI configuration and runtime readiness before a session starts

## Objective

Extend the existing pre-session `robota diagnose` path into a complete provider-neutral doctor/checkup
surface. It must report exact source paths and causes, explain merged configuration provenance, inspect
plugins, skills, commands, hooks, storage and MCP readiness, redact secrets, and offer only bounded
mechanical repairs. Preserve the already-delivered runtime-equivalent provider checks.

## Plan

- [ ] Add `doctor` and `checkup` CLI aliases plus `/doctor` without requiring a working session.
- [ ] Reuse runtime resolvers to report settings precedence, configured endpoint reachability and load failures.
- [ ] Add bounded checks and repair offers for plugins, skills, commands, hooks, storage and MCP.
- [ ] Prove secret redaction, exact diagnostics, exit status and repair confirmation in focused tests.

## Test Plan

Use injected filesystem/network/plugin/MCP fixtures to prove each finding and repair branch. Run the
agent-cli and command package suites plus a built-binary doctor scenario with a deliberately broken
temporary configuration.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`

Run the built CLI as `robota doctor` against an isolated corrupt configuration and failing local MCP
fixture. It must start without constructing a session, name every failing path/cause, print no secret,
offer the supported repair, and exit non-zero; after accepting the repair, a second run must clear it.
