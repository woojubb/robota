---
title: Consolidate permission-prompt.ts duplication
status: backlog
priority: low
created: 2026-03-20
packages:
  - agent-sdk
  - agent-cli
---

# Consolidate permission-prompt.ts duplication

## Problem

Two independent implementations of the terminal approval prompt exist:

- `agent-sdk/src/permissions/permission-prompt.ts` — used by `query()` (print mode)
- `agent-cli/src/permissions/permission-prompt.ts` — used by Ink TUI

Both implement the same terminal Allow/Deny prompt logic. This violates the agent-sdk Core Principle "No duplication."

## Proposed Fix

Consolidate into a single implementation. Options:

1. Keep in `agent-sdk`, have `agent-cli` import from it
2. Keep in `agent-cli`, have `agent-sdk` import from it (requires dependency direction check)
3. Move to `agent-sessions` alongside `ITerminalOutput` (the SSOT for the terminal interface)

Option 1 is simplest since `agent-cli` already depends on `agent-sdk`.
