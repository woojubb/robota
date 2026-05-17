---
title: 'ARCH-REV-005: Fix class-interface-inventory.md stale entries (createProviderFromSettings, CommandEffectQueue)'
status: done
created: 2026-05-18
priority: high
urgency: now
area: .agents/specs/architecture-map/agent-cli/class-interface-inventory.md
depends_on: []
---

## Problem

Two verified inaccuracies in `class-interface-inventory.md`:

1. **`createProviderFromSettings` wrong owner**: Documented as `agent-cli/src/utils/provider-factory.ts` — that file does not exist. The function is exported from `@robota-sdk/agent-framework` and called inside `agent-cli/src/startup/provider-setup.ts::createProviderSetup()`. Test file `__tests__/provider-factory-integration.test.ts` also imports from `agent-framework`, confirming ownership.

2. **`CommandEffectQueue` wrong file**: Documented as `agent-transport/src/tui/command-interaction.ts`. That file is a 9-line re-export shim (`export type { ... }` from `@robota-sdk/agent-interface-tui`). The actual `CommandEffectQueue` class is in `agent-transport/src/tui/hooks/command-effect-queue.ts`.

Source: Senior Developer (C-04, M-03).

## Recommendation

**Proceed without user approval** — both are verified against actual source files.

1. Update `createProviderFromSettings` row: change owner to `@robota-sdk/agent-framework`, add a note "called from `agent-cli/src/startup/provider-setup.ts::createProviderSetup()`."
2. Update `CommandEffectQueue` row: change path from `tui/command-interaction.ts` to `tui/hooks/command-effect-queue.ts`.

## Test Plan

- `find packages/agent-cli/src -name "provider-factory.ts"` must return no results (confirming file doesn't exist)
- `grep -r "createProviderFromSettings" packages/agent-framework/src/` must find the function
- `grep -r "class CommandEffectQueue" packages/agent-transport/src/` must point to `hooks/command-effect-queue.ts`
- `pnpm harness:scan` must pass after the change

## User Execution Test Scenarios

Not applicable — documentation-only change with no runnable user-facing behavior.
