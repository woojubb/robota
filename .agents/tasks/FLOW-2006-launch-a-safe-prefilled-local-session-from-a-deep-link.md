---
title: 'FLOW-2006: Launch a safe prefilled local session from a deep link'
issue: https://github.com/woojubb/robota/issues/2006
status: todo
created: 2026-09-14
priority: high
urgency: now
area: packages/agent-cli, terminal UI package, apps/agent-app
depends_on: []
---

# FLOW-2006: Launch a safe prefilled local session from a deep link

## Objective

Define a versioned `robota://open` launch intent that accepts only a prompt plus cwd or repository target,
passes through existing workspace trust, and pre-fills but never submits the prompt. Register and route the
scheme on supported desktop platforms without accepting provider, permission, plugin or tool configuration.

## Plan

- [ ] Add strict duplicate-rejecting parse/encode contracts with size and field allowlists.
- [ ] Resolve cwd/repository through trusted local state and stop at workspace trust when untrusted.
- [ ] Thread initial input to the TUI without creating a turn until the user submits.
- [ ] Register desktop/CLI URL handling and verify first/second-instance routing on supported platforms.

## Test Plan

Test malformed encoding, duplicates, oversize prompts, unknown/configuration fields and trust refusal.
Execute a local deep-link scenario proving deterministic prefill and zero provider calls before Enter.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`

Open a generated `robota://open` link for a temporary trusted repository, observe the prompt prefilled and
inert, submit it explicitly, then verify an untrusted target stops at the existing trust decision.
