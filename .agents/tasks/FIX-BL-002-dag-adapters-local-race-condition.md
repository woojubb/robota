---
title: Fix dag-adapters-local intermittent build failure (DTS race condition)
status: backlog
created: 2026-03-30
priority: medium
urgency: later
packages:
  - dag-adapters-local
  - dag-core
---

## Problem

`pnpm build` intermittently fails at `dag-adapters-local` DTS generation because `dag-core` DTS is not yet available. Both packages start building concurrently despite dag-adapters-local depending on dag-core.

## Error (when it occurs)

```
packages/dag-adapters-local build: src/in-memory-lease-port.ts(1,47): error TS7016: Could not find a declaration file for module '@robota-sdk/dag-core'.
```

## Root Cause

pnpm runs both builds concurrently. tsup's ESM/CJS step completes fast (no type checking), but DTS step needs the dependency's d.ts files. If dag-core's DTS hasn't finished when dag-adapters-local's DTS starts, it fails.

## Fix Direction

- Add tsconfig project references to enforce build order
- Or use `--workspace-concurrency=1` for affected packages
- Or switch to a two-pass build (ESM/CJS first, then DTS)
