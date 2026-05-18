---
title: 'DOCS-001: Sync content/ documentation to current architecture'
status: todo
created: 2026-05-18
priority: high
urgency: soon
area: content/
depends_on: []
---

## Problem

`content/` documentation contains stale package names that no longer exist.
The current architecture (verified by ARCH-REV-001~013) uses different package names,
but the public-facing docs still reference the old names, misleading users.

Primary staleness: `@robota-sdk/agent-sdk` → `@robota-sdk/agent-framework`, `@robota-sdk/agent-sessions` → `@robota-sdk/agent-session`, `@robota-sdk/agent-runtime` → `@robota-sdk/agent-executor`.

**Scope**: All non-auto-generated, non-v2.0.0 files in `content/`.
Auto-generated files (`content/api-reference/**`) and `content/v2.0.0/**` are excluded.

## Stale References Found

### Package name renames (import-level)

| Old name                     | Current name                                         | Where exported                        |
| ---------------------------- | ---------------------------------------------------- | ------------------------------------- |
| `@robota-sdk/agent-sdk`      | `@robota-sdk/agent-framework`                        | `InteractiveSession`, `createQuery()` |
| `@robota-sdk/agent-sessions` | `@robota-sdk/agent-session`                          | `SessionStore`, `ISessionRecord`      |
| `@robota-sdk/agent-runtime`  | `@robota-sdk/agent-executor`                         | background task contracts             |
| `agent-transport-tui`        | `agent-transport/tui` (subpath of `agent-transport`) | TUI transport                         |

### Files with stale `@robota-sdk/agent-sdk` imports (12 occurrences)

- `content/README.md` — install instructions, ASCII diagram, package table
- `content/examples/streaming.md`
- `content/examples/http-transport.md`
- `content/examples/mcp-transport.md`
- `content/examples/ws-transport.md`
- `content/examples/one-shot-query.md`
- `content/examples/session-management.md`

### Files with stale `@robota-sdk/agent-sessions` imports (3 occurrences)

- `content/examples/session-management.md`
- `content/README.md`

### Files with stale `@robota-sdk/agent-runtime` references (2 occurrences)

- `content/guide/release-2026-05-02.md` (historical, keep as-is — describes what changed at that release)
- `content/README.md`

### Files with stale architecture diagram / prose

- `content/development/README.md` — monorepo structure tree lists `agent-sessions/`, `agent-sdk/`
- `content/guide/architecture.md` — single stale mention: `(was agent-sdk)` annotation (already partially updated but inconsistent)

## What Correct Looks Like

Source of truth: `.agents/specs/architecture-map/agent-system.md` and `packages/agent-framework/src/index.ts`.

```ts
// Current correct imports
import { InteractiveSession } from '@robota-sdk/agent-framework';
import { createQuery } from '@robota-sdk/agent-framework';
import { SessionStore } from '@robota-sdk/agent-framework'; // re-exported from agent-framework
```

Package table in README should list:

- `@robota-sdk/agent-framework` (assembly layer)
- `@robota-sdk/agent-session` (session lifecycle)
- `@robota-sdk/agent-executor` (background task lifecycle)

Architecture diagram in `content/development/README.md` should match
`content/guide/architecture.md` package role table (already up-to-date).

## Implementation Plan

1. **`content/README.md`**: Update install instructions, ASCII diagram, package table, and prose
   - `agent-sdk` → `agent-framework`
   - `agent-sessions` → `agent-session`
   - `agent-runtime` → `agent-executor`
2. **`content/examples/*.md`** (6 files): Update all `import ... from '@robota-sdk/agent-sdk'` to `@robota-sdk/agent-framework`; update `agent-sessions` to `agent-session`
3. **`content/development/README.md`**: Update monorepo structure tree to current package names
4. **`content/guide/architecture.md`**: Remove stale `(was agent-sdk)` annotation; verify rest is consistent
5. **`content/guide/release-2026-05-02.md`**: Leave as-is — it's a historical changelog entry documenting what changed

After each file: verify no remaining `agent-sdk`, `agent-sessions`, `agent-runtime` references.

## Verification Steps

```bash
# Must return 0 results after update (excluding v2.0.0 and api-reference)
grep -rn "@robota-sdk/agent-sdk\|@robota-sdk/agent-sessions\|@robota-sdk/agent-runtime" \
  content/ --include="*.md" \
  | grep -v "v2.0.0" | grep -v "api-reference" | grep -v "release-"

# Verify current exports exist
grep -n "InteractiveSession\|createQuery\|SessionStore" packages/agent-framework/src/index.ts
```

## Test Plan

- All grep checks above return 0 results
- `pnpm harness:scan` passes
- `pnpm docs:build` completes without error

## User Execution Test Scenarios

Not applicable — documentation-only update with no interactive user-facing behavior.
