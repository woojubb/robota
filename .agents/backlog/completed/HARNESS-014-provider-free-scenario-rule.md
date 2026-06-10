---
title: 'HARNESS-014: User execution test scenarios should prefer provider-free observables or built fixtures'
status: done
created: 2026-06-11
completed: 2026-06-11
priority: medium
urgency: soon
area: .agents/backlog, .agents/rules
depends_on: []
---

# HARNESS-014: User execution test scenarios should prefer provider-free observables or built fixtures

## Problem

Scenarios requiring a live LLM transcript (CLI-053 tool-filter run) could not be executed in the
agent environment (no API credentials), leaving the done gate dependent on environment luck. In
contrast, CLI-058's scenario shipped its own mock MCP server fixture and was fully machine-
executable.

## Proposed Change

backlog-execution rule addition: when designing user execution test scenarios, prefer (in order)
(1) provider-free product observables (exit codes, file outputs, provider-free commands),
(2) fixtures built by the work itself (mock servers, sample projects), (3) live-credential runs
only when the verified behavior is inherently provider-coupled — and then the scenario must
state the credential prerequisite explicitly.

## Test Plan

- Rule text added to backlog-execution.md with CLI-053 (bad fit) and CLI-058 (good fit) as
  worked examples.

## User Execution Test Scenarios

Not applicable — rule documentation.

## Evidence

- (2026-06-11) backlog-execution.md "Scenario Design Preference Order" added (provider-free → built fixture → live credential with stated prerequisite; CLI-058 vs CLI-053 examples).
