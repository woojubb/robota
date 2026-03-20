---
title: Fix harness:scan scenario record scope errors
status: completed
priority: medium
created: 2026-03-20
packages:
  - agent-core
  - agent-sessions
  - agent-team
  - agent-provider-bytedance
  - agent-provider-google
  - agent-provider-openai
---

# Fix harness:scan scenario record scope errors

## Problem

`pnpm harness:scan` fails with 6 `invalid-scenario-record-artifact` errors:

```
packages/agent-core/examples/scenarios/offline-verify.record.json: scope must match workspace
packages/agent-provider-bytedance/examples/scenarios/bytedance-video-dry-run.record.json
packages/agent-provider-google/examples/scenarios/google-image-dry-run.record.json
packages/agent-provider-openai/examples/scenarios/executor-verify.record.json
packages/agent-sessions/examples/scenarios/offline-verify.record.json
packages/agent-team/examples/scenarios/offline-verify.record.json
```

The `scope` field inside each `.record.json` does not match the workspace package path (likely stale from before the package rename in `c1c3e877`).

## Impact

- `pnpm harness:scan` exits non-zero, blocking the harness verification gate
- Currently bypassed during publish

## Likely Fix

Update the `scope` field inside each `.record.json` file to match the current workspace path (e.g., `packages/agent-core`).
