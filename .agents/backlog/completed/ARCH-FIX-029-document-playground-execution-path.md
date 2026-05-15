---
title: 'ARCH-FIX-029: Document playground execution path decision in architecture'
status: done
created: 2026-05-15
priority: medium
urgency: later
area: apps/agent-playground, .agents/specs
---

## Problem

`agent-playground` has no dependency on `@robota-sdk/agent-sdk`, `@robota-sdk/agent-sessions`,
or `@robota-sdk/agent-runtime`. Providers are instantiated directly in
`agent-playground/src/lib/playground/robota-executor/remote-providers.ts` lines 29–30:

```ts
new OpenAIProvider(...)
new AnthropicProvider(...)
```

The playground is a separate, lower-capability execution path with no session management,
compaction, permission enforcement, command APIs, or context loading. This is not reflected
in the architecture map.

This may be intentional (lightweight playground for demo/testing purposes) or architectural
drift. The current architecture map does not document the decision either way.

**Source**: ARCH-SA-008 (System Architect review 2026-05-15)

## Scope

**Step 1 — Decision**: Determine whether the playground intentionally bypasses SDK session
management or whether it should eventually wire into `agent-sdk`.

**Step 2 — Document in SPEC and architecture map**:

- Update `apps/agent-playground/docs/SPEC.md` (or create if absent):
  - Add `## Architecture Decision` section explaining the chosen path
  - If intentional: document what capabilities are intentionally absent and why
  - If drift: add a migration path with target architecture
- Update `.agents/specs/architecture-map/agent-system.md`:
  - Reflect actual dependency edges for `agent-playground`
  - Mark as "lightweight / no SDK" or show the intended future edges

## Test Plan

- `apps/agent-playground/docs/SPEC.md` exists and contains an `## Architecture Decision` section
- `.agents/specs/architecture-map/agent-system.md` accurately reflects playground dependencies
- No code changes required for the documentation path

## User Execution Test Scenarios

This backlog item is documentation-only (no runnable behavior change). No user execution
test scenario is required. The deliverable is reviewed by reading the updated SPEC and
architecture map.

Evidence: (to be filled after implementation — confirm SPEC and arch map updated)
