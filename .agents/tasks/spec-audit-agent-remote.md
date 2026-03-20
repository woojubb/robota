---
title: 'Spec Audit: agent-remote'
status: backlog
priority: medium
created: 2026-03-20
packages:
  - agent-remote
---

# Spec Audit: agent-remote

## Goal

agent-remote SPEC.md has public entry point confusion and many SSOT types not actually exported.

## Issues Found (5)

### HIGH (2)

1. **Public entry point mismatch**: package.json exports `.` → `browser.ts`, not `index.ts`. SPEC describes exports as if index.ts is main entry.
2. **Many SSOT types not exported**: ~15 types claimed as SSOT (ITransport, ISimpleRemoteConfig, IRemoteConfig, etc.) are defined internally but not re-exported from any public entry point.

### MEDIUM (2)

3. HttpTransport not exported publicly — SPEC implies it is.
4. Pass-through re-exports of agent-core types in `src/shared/types.ts` — violates AGENTS.md rule #4.

### LOW (1)

5. Test Strategy gaps stale: transport tests and additional client tests now exist.
