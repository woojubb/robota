---
title: 'ARCH-CONF-007: Code conformance verification — ARCH-REV boundary rules'
status: done
created: 2026-05-18
priority: high
urgency: soon
area: packages/
depends_on: []
---

## Problem

ARCH-REV-001~013 fixed architecture map documentation to accurately describe already-correct code.
However, the boundary rules now formally documented in those specs have never been mechanically
verified against the full codebase. Code that was already correct when a rule was written can
drift over time, and new violations can be introduced without detection.

The following boundaries are now SSOT in arch-map docs but have no harness check:

1. **`agent-subagent-runner` isolation** (ARCH-REV-010 SPEC.md)
   - Must NOT import from `@robota-sdk/agent-command` or `@robota-sdk/agent-cli`
   - Must NOT import from `@robota-sdk/agent-session` directly

2. **`agent-team` isolation** (ARCH-REV-011 agent-team.md + updated SPEC.md)
   - Must NOT import from `@robota-sdk/agent-framework`
   - Must NOT import from `@robota-sdk/agent-session`
   - Must NOT import from `@robota-sdk/agent-executor`
   - Must NOT import from `@robota-sdk/agent-command`
   - Must NOT import from `@robota-sdk/agent-cli`

3. **`agent-transport` React isolation** (ARCH-REV-012 transport-architecture.md)
   - Only `agent-transport/src/tui/` may import `react`, `ink`, or related deps
   - Sub-modules must never cross-import (e.g. `/headless` must not import `/tui`)

4. **`agent-interface-transport` and `agent-interface-tui` zero-dep invariant** (ARCH-REV-009 / dependency-direction.md)
   - Must have zero runtime deps (not even `agent-core`)

5. **Assembly layer must not import `agent-team`** (ARCH-REV-011)
   - `agent-framework` must NOT import from `@robota-sdk/agent-team`
   - `agent-command` must NOT import from `@robota-sdk/agent-team`

6. **`agent-core` zero-dep invariant** (existing rule, re-verified)
   - Must have zero deps from other `agent-*` packages

## Recommendation

Run the following grep/import checks and document findings:

```bash
# 1. agent-subagent-runner isolation
grep -r "agent-command\|agent-cli" packages/agent-subagent-runner/src/ --include="*.ts"

# 2. agent-team isolation
grep -r "agent-framework\|agent-session\|agent-executor\|agent-command\|agent-cli" \
  packages/agent-team/src/ --include="*.ts"

# 3. agent-transport React isolation (headless/http/ws/mcp must not import react or tui)
grep -rn "from 'react'\|from 'ink'\|from.*\/tui" \
  packages/agent-transport/src/headless/ \
  packages/agent-transport/src/http/ \
  packages/agent-transport/src/ws/ \
  packages/agent-transport/src/mcp/ --include="*.ts"

# 4. agent-interface-transport zero deps
cat packages/agent-interface-transport/package.json | grep -A20 '"dependencies"'

# 5. Assembly must not import agent-team
grep -r "agent-team" packages/agent-framework/src/ packages/agent-command/src/ --include="*.ts"

# 6. agent-core zero deps
cat packages/agent-core/package.json | grep -A20 '"dependencies"'
```

For any violation found: fix the import boundary violation (move to correct layer or remove).
If a harness check does not exist, create one in `scripts/harness/`.

## Test Plan

- All 6 grep checks above must return 0 results
- `pnpm harness:scan` must pass
- `pnpm typecheck` must pass after any fixes

## User Execution Test Scenarios

Not applicable — automated grep/lint conformance check with no interactive user-facing behavior.
