---
title: 'ARCH-002-p15: Make isInteractiveTerminal injectable in agent-command'
status: done
---

# ARCH-002-p15: Make isInteractiveTerminal injectable in agent-command

## Problem

`agent-command/src/provider/provider-startup.ts:115` contains:

```typescript
function isInteractiveTerminal(): boolean {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}
```

`process.stdin.isTTY` and `process.stdout.isTTY` are terminal I/O concerns that belong in the CLI layer. `agent-command` must not reference them — it has no business knowing whether a terminal is attached.

## Fix

Add `isInteractive?: () => boolean` to `IEnsureProviderConfigOptions` in `agent-command`.

- In `ensureProviderConfig`, replace `isInteractiveTerminal()` with `(options.isInteractive ?? defaultIsInteractive)()`
- Remove `isInteractiveTerminal()` private function from agent-command
- Export `defaultIsInteractive` or keep it private in agent-command (whichever is cleaner)
- In `agent-cli/src/startup/provider-startup.ts`, pass `isInteractive: () => process.stdin.isTTY === true && process.stdout.isTTY === true`

## Files

- `packages/agent-command/src/provider/provider-startup.ts` — inject, remove private function
- `packages/agent-command/src/provider/index.ts` — no change needed
- `packages/agent-cli/src/startup/provider-startup.ts` — supply `isInteractive` callback

## Architecture map update

- `CLI-AUDIT-016` entry to add in layering-audit.md (new audit finding, immediately resolved)
