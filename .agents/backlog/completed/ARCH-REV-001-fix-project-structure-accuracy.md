---
title: 'ARCH-REV-001: Fix project-structure.md accuracy — wrong paths and phantom packages'
status: done
completed: 2026-05-22
created: 2026-05-18
priority: critical
urgency: now
area: .agents/project-structure.md
depends_on: []
---

## Problem

Three accuracy errors in `.agents/project-structure.md` will actively mislead developers:

1. **Wrong app directory path**: Line 25 says `apps/agent-web-ui/` — actual filesystem path is `apps/agent-web/`. The npm package name `@robota-sdk/agent-web-ui` belongs to `packages/agent-web-ui/` (the browser monitor library), not the app directory.
2. **Phantom packages**: `packages/auth/` and `packages/credits/` are listed with descriptions as if they exist — neither directory exists in the filesystem. `capability-placement.md` correctly marks them as "TBD — not yet created."
3. **Stale wildcard patterns**: Line 56 references `agent-transport-*` and `agent-provider-*` wildcards that no longer exist. These were consolidated into `agent-transport` (subpaths) and `agent-provider` (subpaths).

Source: Senior Planner (C-04, M-06, M-08), Senior Developer (M-04, M-05), Senior Design Architect (M-02, M-05).

## Recommendation

**Proceed without user approval** — all three are factual errors verified against the actual filesystem by 3 independent reviewers.

1. Change `apps/agent-web-ui/` → `apps/agent-web/` on the apps directory tree entry.
2. Remove `packages/auth/` and `packages/credits/` from the directory tree. Add a `## Planned Packages (Not Yet Created)` section at the end of the file listing them with a reference to `capability-placement.md`.
3. Replace stale wildcard patterns with accurate language about subpath exports.

## Test Plan

- Read the file before and after to confirm the 3 fixes are applied
- Verify with `ls /Users/.../apps/` that `agent-web/` exists (not `agent-web-ui/`)
- Verify with `ls /Users/.../packages/` that `auth/` and `credits/` do not exist
- `pnpm harness:scan` must pass after the change

## User Execution Test Scenarios

Not applicable — documentation-only change with no runnable user-facing behavior.
