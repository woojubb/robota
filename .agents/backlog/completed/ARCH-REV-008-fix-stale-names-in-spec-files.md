---
title: 'ARCH-REV-008: Fix stale package names in agent-team and agent-web-ui SPEC.md files'
status: done
created: 2026-05-18
priority: high
urgency: now
area: packages/agent-team/docs/SPEC.md, packages/agent-web-ui/docs/SPEC.md
depends_on: []
---

## Problem

Two SPEC.md files reference package names that were renamed, undermining SSOT confidence and preventing mechanical conformance verification:

**`packages/agent-team/docs/SPEC.md`**:

- References `@robota-sdk/agent-event-service` (removed package — functionality merged elsewhere)
- Uses `agent-sdk` and `agent-sessions` (old names → `agent-framework`, `agent-session`)

**`packages/agent-web-ui/docs/SPEC.md`**:

- References `@robota-sdk/agent-transport-ws` (old name → `@robota-sdk/agent-transport/ws` subpath)
- Uses `agent-sdk`, `agent-sessions`, `agent-runtime` (all renamed → `agent-framework`, `agent-session`, `agent-executor`)

The authoritative rename map is in `class-interface-inventory.md` "Package name map (old → current)" table.

Source: Senior Planner (M-04, M-06).

## Recommendation

**Proceed without user approval** — straightforward rename using the authoritative name map. No design decisions required.

Apply the rename map to both SPEC.md files:

- `agent-event-service` → removed, check what replaced it (likely `agent-core` events or `agent-plugin`)
- `agent-sdk` → `agent-framework`
- `agent-sessions` → `agent-session`
- `agent-runtime` → `agent-executor`
- `agent-transport-ws` → `agent-transport` (subpath `/ws`)

## Test Plan

- Read both files before and after
- `grep -n "agent-event-service\|agent-sdk\|agent-sessions\|agent-runtime\|agent-transport-ws" packages/agent-team/docs/SPEC.md packages/agent-web-ui/docs/SPEC.md` must return 0 results after fix
- `pnpm harness:scan` must pass

## User Execution Test Scenarios

Not applicable — documentation-only change with no runnable user-facing behavior.
