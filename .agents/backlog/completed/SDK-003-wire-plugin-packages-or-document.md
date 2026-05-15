---
title: 'SDK-003: Wire plugin packages in assembly or document as consumer opt-in'
status: done
created: 2026-05-15
priority: medium
urgency: later
area: packages/agent-plugin-*, packages/agent-sdk, packages/agent-cli
---

## Problem

All 9 `agent-plugin-*` packages are correctly isolated (depend only on `agent-core`) but none
is registered or used in any production assembly path. No production `agent-sdk`, `agent-cli`,
or `apps/agent-server` source imports any `@robota-sdk/agent-plugin-*`. The plugin architecture
is proven at the contract level but unproven at integration.

**Evidence**: No `agent-cli` or `agent-sdk` production source imports any
`@robota-sdk/agent-plugin-*`. `agent-cli/src/plugins/` does not exist or contains no
plugin registrations.

**Source**: ARCH-SD-005 (Senior Developer review 2026-05-15)

## Decision Required

**Option A — Wire at least one plugin into the CLI assembly**:
Register one plugin (e.g., the most mature `agent-plugin-*`) in the default CLI assembly to
demonstrate the integration path is actually exercised.

**Option B — Explicitly document as consumer opt-in**:
Add an architecture note to `.agents/specs/architecture-map/agent-system.md` and each
`agent-plugin-*/docs/SPEC.md` stating: "Plugins are not built into the CLI by default.
Application consumers register plugins via the SDK assembly API."
Add an example in `packages/agent-sdk/README.md` showing how to register a plugin.

## Scope

**If Option A**:

1. Identify the most integration-ready plugin
2. Add registration in `packages/agent-cli/src/` at the composition root
3. Verify build and tests pass

**If Option B**:

1. Update `.agents/specs/architecture-map/agent-system.md` — add plugin consumer note
2. Update each `agent-plugin-*/docs/SPEC.md` — add "consumer opt-in" status note
3. Add plugin registration example to `packages/agent-sdk/README.md` or docs

## Test Plan

**Option A**:

- Plugin registration code added and builds successfully
- Integration test verifies plugin is active in a CLI session
- `pnpm test` passes

**Option B**:

- Architecture map and all SPEC.md files updated with consumer opt-in language
- Example code compiles correctly

## User Execution Test Scenarios

**Option A scenario**: Plugin is active in CLI session

Prerequisites: Full build with plugin wired

Steps:

1. Run the Robota CLI
2. Verify the wired plugin's behavior is observable (e.g., a plugin command, event handler,
   or hook is active)

Expected: Plugin behavior is visible. No registration errors.

Evidence: (to be filled after implementation)
