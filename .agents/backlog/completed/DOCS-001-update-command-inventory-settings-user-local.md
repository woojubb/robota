---
title: 'DOCS-001: Add /settings and /user-local to command-inventory.md'
status: done
created: 2026-05-15
priority: medium
urgency: later
area: .agents/specs, packages/agent-command-settings
---

## Problem

The canonical command inventory at `.agents/specs/command-inventory.md` does not list the
`/settings` and `/user-local` commands. Both commands are implemented in
`packages/agent-command-settings/src/` and routed via the CLI slash-routing layer. The
inventory is meant to be the authoritative record of all built-in commands.

**Evidence**: `agent-command-settings/src/` exists and exports `/settings` and `/user-local`
handlers. Neither command appears in `.agents/specs/command-inventory.md`.

**Source**: ARCH-SD-006 (Senior Developer review 2026-05-15)

## Scope

1. Add `/settings` entry to `.agents/specs/command-inventory.md`:
   - Owner: `@robota-sdk/agent-command-settings`
   - Host effects: reads/writes user settings file
   - Model visibility: not passed to LLM
   - Description: opens interactive settings editor

2. Add `/user-local` entry to `.agents/specs/command-inventory.md`:
   - Owner: `@robota-sdk/agent-command-settings`
   - Host effects: reads/writes user-local storage
   - Model visibility: not passed to LLM
   - Description: inspects/manages user-local session data

3. (Optional) Add a harness check that detects `agent-command-*` packages without
   corresponding entries in `command-inventory.md` (prevents future omissions)

## Test Plan

- `.agents/specs/command-inventory.md` contains entries for `/settings` and `/user-local`
- Entries include all required fields (owner, host effects, model visibility)
- Harness check (if added) passes for all existing command modules

## User Execution Test Scenarios

This is a documentation update with no observable behavior change. No user execution test
scenario required. Verified by confirming the inventory entries are present and accurate.

Evidence: (to be filled after implementation — confirm entries added)
